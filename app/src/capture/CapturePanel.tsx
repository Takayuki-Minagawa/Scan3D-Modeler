import { useCallback, useEffect, useRef, useState } from 'react';
import { addAsset } from '../db/assets';
import { startJob } from '../jobs/runner';
import { DEFAULT_BLUR_THRESHOLD } from '../jobs/blurClient';
import { Section } from '../ui/common';
import { timestampName } from '../ui/misc';
import { saveStillFromVideo } from './imageUtil';

/**
 * カメラ撮影UI(1B-1)。
 * スマホカメラ / USB接続カメラ / ノートPC内蔵カメラを getUserMedia +
 * enumerateDevices のカメラ選択で同列に扱う(作業計画 前提P4)。
 */
export function CapturePanel(props: { projectId: string; onCaptured: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // getUserMedia要求の世代番号。停止・デバイス切替・アンマウントの後に
  // 解決した古い要求のストリームを確実に破棄するため(破棄しないと
  // streamRefに乗らないままカメラが動き続け、停止手段がなくなる)
  const streamSeq = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  // idle: 待機 / recording: 録画中 / saving: 停止後、保存完了(onstop)待ち
  const [recState, setRecState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const supported = !!navigator.mediaDevices?.getUserMedia;

  const stopCamera = useCallback(() => {
    streamSeq.current++; // 進行中のgetUserMedia要求を無効化する
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setStarting(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera(id?: string) {
    setError('');
    stopCamera();
    const gen = ++streamSeq.current;
    setStarting(true);
    try {
      const video: MediaTrackConstraints = id
        ? { deviceId: { exact: id } }
        : { facingMode: 'environment' }; // スマホでは背面カメラ優先
      video.width = { ideal: 1920 };
      video.height = { ideal: 1080 };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      if (gen !== streamSeq.current) {
        // 待機中に停止/切替/アンマウントされた要求。取得したtrackは即時停止する
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // 権限取得後でないとラベルが得られないため、ここで列挙する
      const all = await navigator.mediaDevices.enumerateDevices();
      if (gen !== streamSeq.current) return; // 以降のUI更新は新しい要求に任せる
      setDevices(all.filter((d) => d.kind === 'videoinput'));
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      if (settings.deviceId) setDeviceId(settings.deviceId);
      setActive(true);
      setStarting(false);
      setStatus(`カメラ起動中: ${track.label || '(名称不明)'}`);
    } catch (e) {
      if (gen !== streamSeq.current) return;
      // 起動途中の失敗(video.play・デバイス列挙など)ではstreamを保持した
      // まま抜けない: 取得済みtrackを停止し、参照と表示も解放する
      // (activeにならず停止ボタンが出ないままカメラが動き続けるのを防ぐ)
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setActive(false);
      setStarting(false);
      setError(
        `カメラを起動できません: ${e instanceof Error ? e.message : String(e)}。` +
          'HTTPSまたはlocalhostでのみカメラを使用できます。ファイル取込も利用できます。',
      );
    }
  }

  async function takePhoto() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    try {
      const { asset, blur } = await saveStillFromVideo(
        v,
        props.projectId,
        `photo_${timestampName()}.jpg`,
      );
      setStatus(
        `撮影しました: ${asset.name}(鮮鋭度 ${Math.round(blur.score)}${
          blur.score < DEFAULT_BLUR_THRESHOLD ? ' — ブレの可能性あり' : ''
        })`,
      );
      props.onCaptured();
    } catch (e) {
      setStatus(`撮影画像を保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    // 前回録画の保存(onstop)完了までは開始しない(recorderRefが門番)
    if (!stream || recState !== 'idle' || recorderRef.current) return;
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    // チャンクはこのMediaRecorder専用のクロージャに保持する
    // (共有バッファだと連続録画で新旧のチャンクが混在・消失する)
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      try {
        const type = rec.mimeType || 'video/webm';
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type });
        if (blob.size === 0) {
          setStatus('録画データが空でした');
          return;
        }
        const asset = await addAsset({
          projectId: props.projectId,
          kind: 'video',
          name: `rec_${timestampName()}.${ext}`,
          blob,
          meta: { source: 'camera' },
        });
        setStatus(`録画を保存しました: ${asset.name}`);
        props.onCaptured();
        if (window.confirm('録画からキーフレーム抽出を開始しますか?(後からでも実行できます)')) {
          await startJob('extractFrames', props.projectId, `フレーム抽出: ${asset.name}`, {
            videoAssetId: asset.id,
            stepMs: 250,
            blurThreshold: DEFAULT_BLUR_THRESHOLD,
          });
          setStatus('フレーム抽出を開始しました(パイプラインタブで進捗を確認できます)');
        }
      } catch (e) {
        setStatus(`録画の保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        recorderRef.current = null;
        setRecState('idle');
      }
    };
    recorderRef.current = rec;
    rec.start(1000);
    setRecState('recording');
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      setRecState('saving');
      recorderRef.current.stop();
    }
  }

  return (
    <Section title="カメラ撮影(スマホ / USBカメラ / 内蔵カメラ)">
      {!supported && (
        <p className="warn-box">
          この環境ではカメラAPIを利用できません(HTTPSまたはlocalhostが必要です)。
          下の「ファイル取込」から画像・動画を追加してください。
        </p>
      )}
      {error && <p className="warn-box">{error}</p>}
      <div className="row wrap">
        {!active ? (
          <button
            className="primary"
            disabled={!supported || starting}
            onClick={() => void startCamera()}
          >
            {starting ? 'カメラ起動中…' : 'カメラを起動'}
          </button>
        ) : (
          <button onClick={stopCamera}>カメラを停止</button>
        )}
        {devices.length > 0 && (
          <select
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value);
              void startCamera(e.target.value);
            }}
          >
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `カメラ ${i + 1}`}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="camera-wrap">
        <video ref={videoRef} playsInline muted className={active ? '' : 'hidden'} />
        {recState === 'recording' && <span className="rec-dot">● REC</span>}
      </div>
      {active && (
        <div className="row wrap">
          <button className="primary" onClick={() => void takePhoto()}>
            静止画を撮影
          </button>
          {recState === 'recording' ? (
            <button className="danger" onClick={stopRecording}>
              録画終了
            </button>
          ) : (
            <button onClick={startRecording} disabled={recState !== 'idle'}>
              {recState === 'saving' ? '録画を保存中…' : '録画開始'}
            </button>
          )}
        </div>
      )}
      {status && <p className="hint">{status}</p>}
      <p className="hint">
        撮影のコツ: 対象物の周囲を「中間高さ→上方→(必要なら)下方」の順に一定距離でゆっくり周回します(使用書§8)。
      </p>
    </Section>
  );
}
