import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import type {
  AppStatus,
  ChatMessage,
  McpCallMeta,
  McpConfig,
  McpLogEntry,
  McpToolDefinition,
} from '../types';

function floatTo16BitPcmBase64(float32: Float32Array, inputSampleRate = 16000): string {
  let samples = float32;
  if (inputSampleRate !== 16000) {
    const ratio = inputSampleRate / 16000;
    const newLen = Math.max(1, Math.floor(float32.length / ratio));
    const resampled = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const idx = Math.min(float32.length - 1, Math.floor(i * ratio));
      resampled[i] = float32[idx];
    }
    samples = resampled;
  }

  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const floats = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    floats[i] = view.getInt16(i * 2, true) / 32768;
  }
  return floats;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function mergeTranscriptChunk(existing: string, chunk: string): string {
  if (!existing) return chunk.trimStart();
  if (!chunk) return existing;
  return `${existing}${chunk}`;
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface UseGeminiLiveOptions {
  mcpConfig: McpConfig;
  tools: McpToolDefinition[];
  onMcpLogs: (entries: McpLogEntry[]) => void;
}

export function useGeminiLive({ mcpConfig, tools, onMcpLogs }: UseGeminiLiveOptions) {
  const [status, setStatus] = useState<AppStatus>('idle');
  const [statusLabel, setStatusLabel] = useState<string>('Sẵn sàng');
  const [isLiveActive, setIsLiveActive] = useState<boolean>(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [interimUserText, setInterimUserText] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'gemini',
      text: 'Xin chào! Cuộc trò chuyện đang kết nối trực tiếp tới Hermes MCP. Gemini sẽ dịch và đọc lại nguyên văn câu trả lời từ Hermes cho bạn.',
      timestamp: nowTimeLabel(),
      mcpCalls: [
        {
          toolName: 'initialize',
          uri: 'hermes://session/initialize',
          args: { protocolVersion: '2025-03-26' },
          result: { serverInfo: 'Hermes-MCP-Core', status: 'ready' },
          mode: 'local-bridge',
        },
      ],
    },
  ]);

  const audioLevelRef = useRef<number>(0.1);
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const ttsCtxRef = useRef<AudioContext | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsGainRef = useRef<GainNode | null>(null);
  const ttsMeterFrameRef = useRef<number>(0);
  const ttsAbortRef = useRef<AbortController | null>(null);

  const isSpeakerMutedRef = useRef<boolean>(false);
  const isLiveActiveRef = useRef<boolean>(false);
  const pendingMcpCallsRef = useRef<McpCallMeta[]>([]);
  const activeUserMsgIdRef = useRef<string | null>(null);
  const activeGeminiMsgIdRef = useRef<string | null>(null);
  const meterFrameRef = useRef<number>(0);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const mcpConfigRef = useRef<McpConfig>(mcpConfig);
  const toolsRef = useRef<McpToolDefinition[]>(tools);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    mcpConfigRef.current = mcpConfig;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'config',
          mcpConfig: {
            endpoint: mcpConfig.endpoint,
            token: mcpConfig.token,
            mode: mcpConfig.mode,
          },
        })
      );
    }
  }, [mcpConfig]);

  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);

  const stopTtsPlayback = useCallback(() => {
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
    if (ttsMeterFrameRef.current) {
      cancelAnimationFrame(ttsMeterFrameRef.current);
      ttsMeterFrameRef.current = 0;
    }
    if (ttsSourceRef.current) {
      try {
        ttsSourceRef.current.stop();
        ttsSourceRef.current.disconnect();
      } catch {
        // Ignore already stopped source
      }
      ttsSourceRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speechSynthesis cancel errors
      }
    }
    if (!isLiveActiveRef.current) {
      audioLevelRef.current = 0.1;
    }
  }, []);

  useEffect(() => {
    isSpeakerMutedRef.current = isSpeakerMuted;
    if (outputGainRef.current && outputCtxRef.current) {
      outputGainRef.current.gain.setValueAtTime(
        isSpeakerMuted ? 0 : 1,
        outputCtxRef.current.currentTime
      );
    }
    if (ttsGainRef.current && ttsCtxRef.current) {
      ttsGainRef.current.gain.setValueAtTime(
        isSpeakerMuted ? 0 : 1,
        ttsCtxRef.current.currentTime
      );
    }
  }, [isSpeakerMuted]);

  const stopAllPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore already stopped nodes
      }
    });
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
  }, []);

  const playGeminiTts = useCallback(
    async (
      text: string,
      options?: {
        voiceName?: McpConfig['voiceName'];
        notifyOnError?: boolean;
        forcePlay?: boolean;
        fallbackToBrowserSpeech?: boolean;
      }
    ): Promise<{ ok: boolean; usedFallback?: boolean; error?: string }> => {
      if ((isSpeakerMutedRef.current && !options?.forcePlay) || !text.trim()) {
        return { ok: false };
      }
      if (options?.forcePlay) {
        isSpeakerMutedRef.current = false;
      }
      stopTtsPlayback();

      const speakFallback = (reason: string) => {
        if (
          options?.fallbackToBrowserSpeech &&
          typeof window !== 'undefined' &&
          'speechSynthesis' in window
        ) {
          try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'vi-VN';
            const voices = window.speechSynthesis.getVoices();
            const viVoice = voices.find((v) => v.lang.toLowerCase().startsWith('vi'));
            if (viVoice) {
              utterance.voice = viVoice;
            }
            window.speechSynthesis.speak(utterance);
            return { ok: true, usedFallback: true, error: reason };
          } catch {
            // Fall through to error return
          }
        }
        if (options?.notifyOnError) {
          setErrorMessage(reason);
        }
        return { ok: false, error: reason };
      };

      const abortController = new AbortController();
      ttsAbortRef.current = abortController;

      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          return speakFallback('Vui lòng đăng nhập tài khoản để sử dụng giọng đọc Gemini.');
        }

        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            text,
            voiceName: options?.voiceName ?? mcpConfigRef.current.voiceName,
          }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          const reason = errData.error || 'Không thể phát thử giọng nói Gemini.';
          return speakFallback(reason);
        }

        const data = (await res.json()) as { audio?: string };
        if (!data.audio || abortController.signal.aborted) {
          return { ok: false };
        }

        let ttsCtx = ttsCtxRef.current;
        if (!ttsCtx || ttsCtx.state === 'closed') {
          ttsCtx = new AudioContext();
          ttsCtxRef.current = ttsCtx;
        }
        if (ttsCtx.state === 'suspended') {
          await ttsCtx.resume();
        }

        const wavBuffer = base64ToArrayBuffer(data.audio);
        const audioBuffer = await ttsCtx.decodeAudioData(wavBuffer);
        if (abortController.signal.aborted) return { ok: false };

        const source = ttsCtx.createBufferSource();
        source.buffer = audioBuffer;

        const analyser = ttsCtx.createAnalyser();
        analyser.fftSize = 256;
        const gainNode = ttsCtx.createGain();
        gainNode.gain.value = isSpeakerMutedRef.current ? 0 : 1;
        ttsGainRef.current = gainNode;

        source.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(ttsCtx.destination);

        ttsSourceRef.current = source;
        setStatus('speaking');
        setStatusLabel('Đang nói...');

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const updateTtsMeter = () => {
          if (!ttsSourceRef.current) return;
          analyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) sum += freqData[i];
          const avg = sum / freqData.length;
          audioLevelRef.current = Math.max(0.2, Math.min(1.2, avg / 50 + 0.18));
          ttsMeterFrameRef.current = requestAnimationFrame(updateTtsMeter);
        };
        ttsMeterFrameRef.current = requestAnimationFrame(updateTtsMeter);

        source.onended = () => {
          if (ttsSourceRef.current === source) {
            ttsSourceRef.current = null;
          }
          if (ttsMeterFrameRef.current) {
            cancelAnimationFrame(ttsMeterFrameRef.current);
            ttsMeterFrameRef.current = 0;
          }
          if (!isLiveActiveRef.current) {
            audioLevelRef.current = 0.1;
            setStatus('idle');
            setStatusLabel('Sẵn sàng');
          }
        };

        source.start(0);
        return { ok: true };
      } catch (err) {
        if (!isLiveActiveRef.current) {
          setStatus('idle');
          setStatusLabel('Sẵn sàng');
        }
        if (abortController.signal.aborted) return { ok: false };
        const msg = err instanceof Error ? err.message : 'Lỗi phát giọng nói Gemini.';
        return speakFallback(msg);
      }
    },
    [stopTtsPlayback]
  );

  const stopLiveSession = useCallback(() => {
    isLiveActiveRef.current = false;
    setIsLiveActive(false);
    setInterimUserText('');

    if (meterFrameRef.current) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = 0;
    }

    stopAllPlayback();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
      outputAnalyserRef.current = null;
      outputGainRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore
      }
      wsRef.current = null;
    }

    activeUserMsgIdRef.current = null;
    activeGeminiMsgIdRef.current = null;
    pendingMcpCallsRef.current = [];
    audioLevelRef.current = 0.1;
    setStatus('idle');
    setStatusLabel('Sẵn sàng');
  }, [stopAllPlayback]);

  useEffect(() => {
    return () => {
      stopLiveSession();
      stopTtsPlayback();
      if (ttsCtxRef.current) {
        ttsCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopLiveSession, stopTtsPlayback]);

  const appendOrUpdateTranscript = useCallback(
    (role: 'user' | 'gemini', chunkText: string) => {
      if (!chunkText) return;

      if (role === 'user') {
        activeGeminiMsgIdRef.current = null;
        setInterimUserText((prev) => mergeTranscriptChunk(prev, chunkText));

        const currentId = activeUserMsgIdRef.current;
        if (!currentId) {
          const newId = `user-${Date.now()}`;
          activeUserMsgIdRef.current = newId;
          setMessages((prev) => [
            ...prev,
            {
              id: newId,
              role: 'user',
              text: chunkText.trimStart(),
              timestamp: nowTimeLabel(),
              isInterim: true,
            },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentId
                ? { ...m, text: mergeTranscriptChunk(m.text, chunkText) }
                : m
            )
          );
        }
      } else {
        if (activeUserMsgIdRef.current) {
          const finishedUserId = activeUserMsgIdRef.current;
          activeUserMsgIdRef.current = null;
          setInterimUserText('');
          setMessages((prev) =>
            prev.map((m) =>
              m.id === finishedUserId ? { ...m, text: m.text.trim(), isInterim: false } : m
            )
          );
        }

        const attachedMcp = pendingMcpCallsRef.current;
        const currentId = activeGeminiMsgIdRef.current;
        if (!currentId) {
          const newId = `gemini-${Date.now()}`;
          activeGeminiMsgIdRef.current = newId;
          pendingMcpCallsRef.current = [];
          setMessages((prev) => [
            ...prev,
            {
              id: newId,
              role: 'gemini',
              text: chunkText.trimStart(),
              timestamp: nowTimeLabel(),
              mcpCalls: attachedMcp.length > 0 ? attachedMcp : undefined,
              isInterim: true,
            },
          ]);
        } else {
          pendingMcpCallsRef.current = [];
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== currentId) return m;
              const mergedCalls = [...(m.mcpCalls ?? []), ...attachedMcp];
              return {
                ...m,
                text: mergeTranscriptChunk(m.text, chunkText),
                mcpCalls: mergedCalls.length > 0 ? mergedCalls : undefined,
              };
            })
          );
        }
      }
    },
    []
  );

  const playPcm24kChunk = useCallback((base64Audio: string) => {
    const outCtx = outputCtxRef.current;
    const outGain = outputGainRef.current;
    if (!outCtx || !outGain) return;

    if (outCtx.state === 'suspended') {
      outCtx.resume().catch(() => {});
    }

    const floats = base64PcmToFloat32(base64Audio);
    if (floats.length === 0) return;

    const buffer = outCtx.createBuffer(1, floats.length, 24000);
    buffer.getChannelData(0).set(floats);

    const source = outCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(outGain);

    const startAt = Math.max(outCtx.currentTime, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0 && isLiveActiveRef.current) {
        setStatus('listening');
        setStatusLabel('Đang nghe...');
      }
    };
  }, []);

  const startLiveSession = useCallback(async () => {
    if (isLiveActiveRef.current) return;
    stopTtsPlayback();
    setErrorMessage(null);
    setStatus('connecting');
    setStatusLabel('Đang kết nối...');

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        setErrorMessage('Vui lòng đăng nhập tài khoản để bắt đầu trò chuyện Gemini Live.');
        setStatus('idle');
        setStatusLabel('Sẵn sàng');
        return;
      }

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      micStreamRef.current = micStream;

      let inputCtx: AudioContext;
      try {
        inputCtx = new AudioContext({ sampleRate: 16000 });
      } catch {
        inputCtx = new AudioContext();
      }
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      await Promise.all([inputCtx.resume(), outputCtx.resume()]);
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const outAnalyser = outputCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      const outGain = outputCtx.createGain();
      outGain.gain.value = isSpeakerMutedRef.current ? 0 : 1;
      outGain.connect(outAnalyser);
      outAnalyser.connect(outputCtx.destination);
      outputAnalyserRef.current = outAnalyser;
      outputGainRef.current = outGain;

      const micSource = inputCtx.createMediaStreamSource(micStream);
      const micAnalyser = inputCtx.createAnalyser();
      micAnalyser.fftSize = 256;
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      const silentGain = inputCtx.createGain();
      silentGain.gain.value = 0;

      micSource.connect(micAnalyser);
      micSource.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(inputCtx.destination);
      processorRef.current = processor;

      const cfg = mcpConfigRef.current;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams({
        voice: cfg.voiceName,
        endpoint: cfg.endpoint,
        token: cfg.token,
        mode: cfg.mode,
        idToken,
      });
      const wsUrl = `${wsProtocol}//${window.location.host}/live?${params.toString()}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      isLiveActiveRef.current = true;
      setIsLiveActive(true);

      const micFreq = new Uint8Array(micAnalyser.frequencyBinCount);
      const outFreq = new Uint8Array(outAnalyser.frequencyBinCount);

      const updateMeter = () => {
        if (!isLiveActiveRef.current) return;
        let level = 0.14;

        if (activeSourcesRef.current.size > 0 && outputAnalyserRef.current) {
          outputAnalyserRef.current.getByteFrequencyData(outFreq);
          let sum = 0;
          for (let i = 0; i < outFreq.length; i++) sum += outFreq[i];
          const avg = sum / outFreq.length;
          level = Math.max(0.24, Math.min(1.2, avg / 52 + 0.2));
        } else {
          micAnalyser.getByteFrequencyData(micFreq);
          let sum = 0;
          for (let i = 0; i < micFreq.length; i++) sum += micFreq[i];
          const avg = sum / micFreq.length;
          level = Math.max(0.14, Math.min(1.15, avg / 58 + 0.12));
        }

        audioLevelRef.current = level;
        meterFrameRef.current = requestAnimationFrame(updateMeter);
      };
      meterFrameRef.current = requestAnimationFrame(updateMeter);

      processor.onaudioprocess = (event) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const floatSamples = event.inputBuffer.getChannelData(0);
        const base64 = floatTo16BitPcmBase64(floatSamples, inputCtx.sampleRate);
        wsRef.current.send(JSON.stringify({ type: 'audio', data: base64 }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            data?: string;
            text?: string;
            message?: string;
            status?: AppStatus;
            label?: string;
            mcpCall?: McpCallMeta;
            logs?: McpLogEntry[];
          };

          switch (msg.type) {
            case 'ready':
              setStatus('listening');
              setStatusLabel('Đang nghe...');
              break;

            case 'inputTranscript':
              if (msg.text) {
                setStatus('listening');
                setStatusLabel('Đang nghe...');
                appendOrUpdateTranscript('user', msg.text);
              }
              break;

            case 'outputTranscript':
              if (msg.text) {
                setStatus('speaking');
                setStatusLabel('Đang trả lời...');
                appendOrUpdateTranscript('gemini', msg.text);
              }
              break;

            case 'audio':
              if (msg.data) {
                setStatus('speaking');
                setStatusLabel('Đang nói...');
                playPcm24kChunk(msg.data);
              }
              break;

            case 'interrupted':
              stopAllPlayback();
              activeGeminiMsgIdRef.current = null;
              setStatus('listening');
              setStatusLabel('Đang nghe...');
              break;

            case 'turnComplete': {
              const finishedId = activeGeminiMsgIdRef.current;
              activeGeminiMsgIdRef.current = null;
              if (finishedId) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === finishedId ? { ...m, text: m.text.trim(), isInterim: false } : m
                  )
                );
              }
              if (activeSourcesRef.current.size === 0 && isLiveActiveRef.current) {
                setStatus('listening');
                setStatusLabel('Đang nghe...');
              }
              break;
            }

            case 'status':
              if (msg.status) setStatus(msg.status);
              if (msg.label) setStatusLabel(msg.label);
              break;

            case 'mcpCall':
              if (msg.mcpCall) {
                if (activeGeminiMsgIdRef.current) {
                  const targetId = activeGeminiMsgIdRef.current;
                  const callMeta = msg.mcpCall;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === targetId
                        ? { ...m, mcpCalls: [...(m.mcpCalls ?? []), callMeta] }
                        : m
                    )
                  );
                } else {
                  pendingMcpCallsRef.current.push(msg.mcpCall);
                }
              }
              break;

            case 'mcpLog':
              if (msg.logs && msg.logs.length > 0) {
                onMcpLogs(msg.logs);
              }
              break;

            case 'error':
              setErrorMessage(msg.message || 'Kết nối Gemini Live gặp sự cố.');
              stopLiveSession();
              break;

            case 'closed':
              if (isLiveActiveRef.current) {
                stopLiveSession();
              }
              break;
          }
        } catch {
          // Ignore invalid JSON frames
        }
      };

      ws.onerror = () => {
        setErrorMessage('Không thể thiết lập WebSocket tới Gemini Live.');
        stopLiveSession();
      };

      ws.onclose = () => {
        if (isLiveActiveRef.current) {
          stopLiveSession();
        }
      };
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Trình duyệt chưa được cấp quyền Micro. Bạn vẫn có thể nhắn tin bằng bàn phím.'
          : err instanceof Error
          ? err.message
          : 'Không thể khởi động Micro.';
      setErrorMessage(msg);
      stopLiveSession();
    }
  }, [appendOrUpdateTranscript, onMcpLogs, playPcm24kChunk, stopAllPlayback, stopLiveSession, stopTtsPlayback]);

  const toggleLiveSession = useCallback(() => {
    if (isLiveActiveRef.current) {
      stopLiveSession();
    } else {
      startLiveSession();
    }
  }, [startLiveSession, stopLiveSession]);

  const sendTextMessage = useCallback(
    async (rawText: string) => {
      const clean = rawText.trim();
      if (!clean) return;
      setErrorMessage(null);
      stopTtsPlayback();

      // If WebSocket Live session is active, inject text straight into the live voice session
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        activeGeminiMsgIdRef.current = null;
        setMessages((prev) => [
          ...prev,
          {
            id: `user-${Date.now()}`,
            role: 'user',
            text: clean,
            timestamp: nowTimeLabel(),
          },
        ]);
        setStatus('thinking');
        setStatusLabel('Đang xử lý...');
        wsRef.current.send(JSON.stringify({ type: 'text', text: clean }));
        return;
      }

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: clean,
        timestamp: nowTimeLabel(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStatus('thinking');
      setStatusLabel('Hermes MCP...');

      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          throw new Error('Vui lòng đăng nhập tài khoản để gửi tin nhắn tới Gemini.');
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            history: messagesRef.current.map((m) => ({ role: m.role, text: m.text })),
            message: clean,
            mcpConfig: mcpConfigRef.current,
            tools: toolsRef.current,
          }),
        });

        const data = (await res.json()) as {
          text?: string;
          mcpCalls?: McpCallMeta[];
          mcpLogs?: McpLogEntry[];
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        if (data.mcpLogs && data.mcpLogs.length > 0) {
          onMcpLogs(data.mcpLogs);
        }

        const replyText = data.text || 'Mình đã xử lý yêu cầu của bạn.';
        setMessages((prev) => [
          ...prev,
          {
            id: `gemini-${Date.now()}`,
            role: 'gemini',
            text: replyText,
            timestamp: nowTimeLabel(),
            mcpCalls: data.mcpCalls && data.mcpCalls.length > 0 ? data.mcpCalls : undefined,
          },
        ]);

        if (mcpConfigRef.current.speakTextReplies && !isSpeakerMutedRef.current) {
          await playGeminiTts(replyText);
        } else {
          setStatus('idle');
          setStatusLabel('Sẵn sàng');
        }
      } catch (err) {
        const errText = err instanceof Error ? err.message : 'Lỗi kết nối Gemini API.';
        setErrorMessage(errText);
        setStatus('idle');
        setStatusLabel('Sẵn sàng');
      }
    },
    [onMcpLogs, playGeminiTts, stopTtsPlayback]
  );

  const replaceMessages = useCallback(
    (nextMessages: ChatMessage[]) => {
      stopTtsPlayback();
      activeUserMsgIdRef.current = null;
      activeGeminiMsgIdRef.current = null;
      setMessages(nextMessages);
      setErrorMessage(null);
      if (!isLiveActiveRef.current) {
        setStatus('idle');
        setStatusLabel('Sẵn sàng');
      }
    },
    [stopTtsPlayback]
  );

  const resetMessages = useCallback(() => {
    replaceMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'gemini',
        text: 'Xin chào! Cuộc trò chuyện mới đã kết nối trực tiếp tới Hermes MCP; Gemini sẽ dịch và đọc lại câu trả lời của Hermes.',
        timestamp: nowTimeLabel(),
      },
    ]);
  }, [replaceMessages]);

  return {
    status,
    statusLabel,
    isLiveActive,
    isSpeakerMuted,
    setIsSpeakerMuted,
    errorMessage,
    setErrorMessage,
    interimUserText,
    messages,
    audioLevelRef,
    toggleLiveSession,
    sendTextMessage,
    playGeminiTts,
    replaceMessages,
    resetMessages,
  };
}
