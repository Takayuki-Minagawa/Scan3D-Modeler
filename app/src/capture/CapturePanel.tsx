import { useCallback, useEffect, useRef, useState } from 'react';
import { addAsset } from '../db/assets';
import { localizeError } from '../errorText';
import { DEFAULT_BLUR_THRESHOLD } from '../jobs/blurClient';
import { useI18n } from '../i18n';
import { Section } from '../ui/common';
import { timestampName } from '../ui/misc';
import { saveStillFromVideo } from './imageUtil';
import { startFrameExtraction } from './startFrameExtraction';

type LocalizedMessage = { ja: string; en: string };

/**
 * カメラ撮影UI(1B-1)。
 * スマホカメラ / USB接続カメラ / ノートPC内蔵カメラを getUserMedia +
 * enumerateDevices のカメラ選択で同列に扱う(作業計画 前提P4)。
 */
export function CapturePanel(props: { projectId: string; onCaptured: () => void }) {
  const { tr } = useI18n();
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
  // stopCameraなどのstable callbackからも、直前に同期更新した状態を参照する。
  const recStateRef = useRef<'idle' | 'recording' | 'saving'>('idle');
  const [status, setStatus] = useState<LocalizedMessage | null>(null);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const supported = !!navigator.mediaDevices?.getUserMedia;

  const updateRecState = useCallback((next: 'idle' | 'recording' | 'saving') => {
    recStateRef.current = next;
    setRecState(next);
  }, []);

  /** 開始失敗・保存完了後に、Recorderの参照とイベントhandlerを確実に解放する。 */
  const releaseRecorder = useCallback(
    (rec: MediaRecorder) => {
      rec.ondataavailable = null;
      rec.onstop = null;
      if (recorderRef.current === rec) recorderRef.current = null;
      updateRecState('idle');
    },
    [updateRecState],
  );

  /** recording/pausedなら保存待ちへ即時遷移して停止し、staleなinactive参照も解放する。 */
  const requestRecorderStop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording' || rec.state === 'paused') {
      updateRecState('saving');
      try {
        rec.stop();
      } catch (e) {
        releaseRecorder(rec);
        const reason = localizeError(e);
        setError({
          ja: `録画を停止できません: ${reason.ja}`,
          en: `Could not stop recording: ${reason.en}`,
        });
      }
    } else if (recStateRef.current !== 'saving') {
      // start失敗等でonstopが来ないinactive recorderを門番として残さない。
      releaseRecorder(rec);
    }
  }, [releaseRecorder, updateRecState]);

  const stopCamera = useCallback(() => {
    streamSeq.current++; // 進行中のgetUserMedia要求を無効化する
    // trackを止める前にUIをsavingへ変え、新stream上へ偽のREC表示を持ち越さない。
    requestRecorderStop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setStarting(false);
  }, [requestRecorderStop]);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera(id?: string) {
    setError(null);
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
      setStatus({
        ja: `カメラ起動中: ${track.label || '(名称不明)'}`,
        en: `Camera is active: ${track.label || '(unnamed)'}`,
      });
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
      const reason = localizeError(e);
      setError({
        ja:
          `カメラを起動できません: ${reason.ja}。` +
          'HTTPSまたはlocalhostでのみカメラを使用できます。ファイル取込も利用できます。',
        en:
          `Could not start camera: ${reason.en}. ` +
          'Camera access requires HTTPS or localhost. You can also use file import.',
      });
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
      const sharpness = Math.round(blur.score);
      const mayBeBlurry = blur.score < DEFAULT_BLUR_THRESHOLD;
      setStatus({
        ja: `撮影しました: ${asset.name}(鮮鋭度 ${sharpness}${
          mayBeBlurry ? ' — ブレの可能性あり' : ''
        })`,
        en: `Photo captured: ${asset.name} (sharpness ${sharpness}${
          mayBeBlurry ? ' — may be blurry' : ''
        })`,
      });
      props.onCaptured();
    } catch (e) {
      const reason = localizeError(e);
      setStatus({
        ja: `撮影画像を保存できませんでした: ${reason.ja}`,
        en: `Could not save captured photo: ${reason.en}`,
      });
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    // 前回録画の保存(onstop)完了までは開始しない(recorderRefが門番)
    if (!stream || recStateRef.current !== 'idle' || recorderRef.current) return;
    setError(null);
    let rec: MediaRecorder | null = null;
    try {
      const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
      ];
      const mime = candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
      const createdRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec = createdRecorder;
      // チャンクはこのMediaRecorder専用のクロージャに保持する
      // (共有バッファだと連続録画で新旧のチャンクが混在・消失する)
      const chunks: Blob[] = [];
      createdRecorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      createdRecorder.onstop = async () => {
        try {
          const type = createdRecorder.mimeType || 'video/webm';
          const ext = type.includes('mp4') ? 'mp4' : 'webm';
          const blob = new Blob(chunks, { type });
          if (blob.size === 0) {
            setStatus({ ja: '録画データが空でした', en: 'The recording is empty.' });
            return;
          }
          const asset = await addAsset({
            projectId: props.projectId,
            kind: 'video',
            name: `rec_${timestampName()}.${ext}`,
            blob,
            meta: { source: 'camera' },
          });
          setStatus({
            ja: `録画を保存しました: ${asset.name}`,
            en: `Recording saved: ${asset.name}`,
          });
          props.onCaptured();
          if (
            window.confirm(
              tr(
                '録画からキーフレーム抽出を開始しますか?(後からでも実行できます)',
                'Start keyframe extraction from this recording? (You can do this later.)',
              ),
            )
          ) {
            try {
              const started = await startFrameExtraction(props.projectId, asset.id, asset.name);
              setStatus(
                started
                  ? {
                      ja: 'フレーム抽出を開始しました(パイプラインタブで進捗を確認できます)',
                      en: 'Keyframe extraction started (check progress in the Pipeline tab).',
                    }
                  : {
                      ja: 'この動画のフレーム抽出はすでに実行中または一時停止中です',
                      en: 'Keyframe extraction for this video is already running or paused.',
                    },
              );
            } catch (e) {
              // 動画本体の保存は成功済み。抽出開始だけの失敗として区別する。
              const reason = localizeError(e);
              setStatus({
                ja: `録画は保存しましたが、フレーム抽出を開始できません: ${reason.ja}`,
                en: `The recording was saved, but keyframe extraction could not start: ${reason.en}`,
              });
            }
          }
        } catch (e) {
          const reason = localizeError(e);
          setStatus({
            ja: `録画の保存に失敗しました: ${reason.ja}`,
            en: `Could not save recording: ${reason.en}`,
          });
        } finally {
          // onstopはこのrecorderに対応する保存が完了した時点でのみ門番を外す。
          releaseRecorder(createdRecorder);
        }
      };
      recorderRef.current = createdRecorder;
      // constructorだけでなくstart()も同期throwするため、ref設定後も同じtryで囲む。
      createdRecorder.start(1000);
      updateRecState('recording');
    } catch (e) {
      if (rec) {
        // start失敗時はonstopが発火しない。handler/ref/stateをその場で元へ戻す。
        releaseRecorder(rec);
        if (rec.state !== 'inactive') {
          try {
            rec.stop();
          } catch {
            // 失敗経路の後始末なので、元の開始エラーを優先して表示する。
          }
        }
      } else {
        recorderRef.current = null;
        updateRecState('idle');
      }
      const reason = localizeError(e);
      setError({
        ja: `録画を開始できません: ${reason.ja}`,
        en: `Could not start recording: ${reason.en}`,
      });
    }
  }

  function stopRecording() {
    requestRecorderStop();
  }

  return (
    <Section
      title={tr(
        'カメラ撮影(スマホ / USBカメラ / 内蔵カメラ)',
        'Camera capture (phone / USB camera / built-in camera)',
      )}
    >
      {!supported && (
        <p className="warn-box">
          {tr(
            'この環境ではカメラAPIを利用できません(HTTPSまたはlocalhostが必要です)。下の「ファイル取込」から画像・動画を追加してください。',
            'Camera access is unavailable in this environment (HTTPS or localhost is required). Add images or videos using File import below.',
          )}
        </p>
      )}
      {error && <p className="warn-box">{tr(error.ja, error.en)}</p>}
      <div className="row wrap">
        {!active ? (
          <button
            className="primary"
            disabled={!supported || starting}
            onClick={() => void startCamera()}
          >
            {starting
              ? tr('カメラ起動中…', 'Starting camera…')
              : tr('カメラを起動', 'Start camera')}
          </button>
        ) : (
          <button onClick={stopCamera}>{tr('カメラを停止', 'Stop camera')}</button>
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
                {d.label || tr(`カメラ ${i + 1}`, `Camera ${i + 1}`)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="camera-wrap">
        <video ref={videoRef} playsInline muted className={active ? '' : 'hidden'} />
        {recState === 'recording' && (
          <span className="rec-dot">{tr('● 録画中', '● REC')}</span>
        )}
      </div>
      {active && (
        <div className="row wrap">
          <button className="primary" onClick={() => void takePhoto()}>
            {tr('静止画を撮影', 'Capture photo')}
          </button>
          {recState === 'recording' ? (
            <button className="danger" onClick={stopRecording}>
              {tr('録画終了', 'Stop recording')}
            </button>
          ) : (
            <button onClick={startRecording} disabled={recState !== 'idle'}>
              {recState === 'saving'
                ? tr('録画を保存中…', 'Saving recording…')
                : tr('録画開始', 'Start recording')}
            </button>
          )}
        </div>
      )}
      {status && <p className="hint">{tr(status.ja, status.en)}</p>}
      <p className="hint">
        {tr(
          '撮影のコツ: 対象物の周囲を「中間高さ→上方→(必要なら)下方」の順に一定距離でゆっくり周回します(使用書§8)。',
          'Capture tip: Move slowly around the object at a consistent distance, from mid-height to above and, if needed, below.',
        )}
      </p>
    </Section>
  );
}
