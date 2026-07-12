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
  const chunksRef = useRef<BlobPart[]>([]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [active, setActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const supported = !!navigator.mediaDevices?.getUserMedia;

  const stopCamera = useCallback(() => {
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setRecording(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera(id?: string) {
    setError('');
    try {
      stopCamera();
      const video: MediaTrackConstraints = id
        ? { deviceId: { exact: id } }
        : { facingMode: 'environment' }; // スマホでは背面カメラ優先
      video.width = { ideal: 1920 };
      video.height = { ideal: 1080 };
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      // 権限取得後でないとラベルが得られないため、ここで列挙する
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput'));
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      if (settings.deviceId) setDeviceId(settings.deviceId);
      setActive(true);
      setStatus(`カメラ起動中: ${track.label || '(名称不明)'}`);
    } catch (e) {
      setError(
        `カメラを起動できません: ${e instanceof Error ? e.message : String(e)}。` +
          'HTTPSまたはlocalhostでのみカメラを使用できます。ファイル取込も利用できます。',
      );
    }
  }

  async function takePhoto() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
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
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = async () => {
      const type = rec.mimeType || 'video/webm';
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(chunksRef.current, { type });
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
    };
    rec.start(1000);
    recorderRef.current = rec;
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
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
          <button className="primary" disabled={!supported} onClick={() => startCamera()}>
            カメラを起動
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
        {recording && <span className="rec-dot">● REC</span>}
      </div>
      {active && (
        <div className="row wrap">
          <button className="primary" onClick={() => void takePhoto()}>
            静止画を撮影
          </button>
          {!recording ? (
            <button onClick={startRecording}>録画開始</button>
          ) : (
            <button className="danger" onClick={stopRecording}>
              録画終了
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
