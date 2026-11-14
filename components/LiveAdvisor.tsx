import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Voice3DOrb } from './Voice3DOrb';
import { useFinMind } from '../context/FinMindContext';
import {
  resampleTo16kHz,
  floatTo16BitPcmBase64,
  calculateRmsVolume,
} from '../utils/audioResampler';

interface LiveAdvisorProps {
  onClose?: () => void;
  autoConnect?: boolean;
}

export const LiveAdvisor: React.FC<LiveAdvisorProps> = ({ onClose, autoConnect = true }) => {
  const { logAnalyticsEvent } = useFinMind();

  const [permissionDenied, setPermissionDenied] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [volume, setVolume] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletBlobUrlRef = useRef<string | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const lastVolumeUpdateRef = useRef<number>(0);
  const sessionRunIdRef = useRef<number>(0);

  const stopMediaTracks = (stream?: MediaStream | null) => {
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => track.stop());
    } catch {}
  };

  const cleanupAudioGraph = useCallback(() => {
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
      } catch {}
      workletNodeRef.current = null;
    }
    if (workletBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(workletBlobUrlRef.current);
      } catch {}
      workletBlobUrlRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch {}
      processorRef.current = null;
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch {}
      silentGainRef.current = null;
    }
    if (inputSourceRef.current) {
      try {
        inputSourceRef.current.disconnect();
      } catch {}
      inputSourceRef.current = null;
    }
    stopMediaTracks(mediaStreamRef.current);
    mediaStreamRef.current = null;

    if (inputAudioContextRef.current) {
      try {
        if (inputAudioContextRef.current.state !== 'closed') {
          inputAudioContextRef.current.close();
        }
      } catch {}
      inputAudioContextRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.suspend();
      } catch {}
    }
  }, []);

  const disconnect = useCallback(() => {
    sessionRunIdRef.current += 1;
    cleanupAudioGraph();
    setIsConnected(false);
    setIsConnecting(false);
    setVolume(0);
  }, [cleanupAudioGraph]);

  const decodeAudioData = async (
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number
  ): Promise<AudioBuffer> => {
    const dataInt16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
    const frameCount = Math.floor(dataInt16.length / numChannels);
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  };

  const acquireMicrophoneStream = async (): Promise<MediaStream> => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('UNSUPPORTED_MEDIA');
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  };

  const handleAudioSamplesFrame = useCallback((rawSamples: Float32Array, nativeRate: number, runId: number) => {
    if (sessionRunIdRef.current !== runId) return;
    const rms = calculateRmsVolume(rawSamples);
    const now = performance.now();
    if (now - lastVolumeUpdateRef.current > 45) {
      lastVolumeUpdateRef.current = now;
      setVolume(rms);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const downsampled = resampleTo16kHz(rawSamples, nativeRate);
      const audioBase64 = floatTo16BitPcmBase64(downsampled);
      try {
        wsRef.current.send(JSON.stringify({ audio: audioBase64 }));
      } catch {}
    }
  }, []);

  const connect = useCallback(async () => {
    const runId = ++sessionRunIdRef.current;

    cleanupAudioGraph();
    setIsConnecting(true);
    setIsConnected(false);
    setPermissionDenied(false);

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContextClass();
        outputNodeRef.current = audioContextRef.current.createGain();
        outputNodeRef.current.connect(audioContextRef.current.destination);
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume().catch(() => {});
      }

      const inputCtx = new AudioContextClass();
      inputAudioContextRef.current = inputCtx;
      if (inputCtx.state === 'suspended') {
        await inputCtx.resume().catch(() => {});
      }

      const stream = await acquireMicrophoneStream();

      if (sessionRunIdRef.current !== runId) {
        stopMediaTracks(stream);
        try {
          inputCtx.close();
        } catch {}
        return;
      }

      mediaStreamRef.current = stream;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live?mode=brief`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        if (sessionRunIdRef.current !== runId) {
          ws.close();
          return;
        }

        setIsConnecting(false);
        setIsConnected(true);
        logAnalyticsEvent('voice_session', 'agent', 'integrated_voice');

        const nativeRate = inputCtx.sampleRate || 48000;
        const source = inputCtx.createMediaStreamSource(stream);
        inputSourceRef.current = source;

        const silentGain = inputCtx.createGain();
        silentGain.gain.value = 0;
        silentGainRef.current = silentGain;

        let workletAttached = false;
        if (typeof inputCtx.audioWorklet?.addModule === 'function' && typeof AudioWorkletNode !== 'undefined') {
          try {
            const workletCode = `
              class LiddyCaptureProcessor extends AudioWorkletProcessor {
                process(inputs) {
                  const ch = inputs[0]?.[0];
                  if (ch && ch.length) {
                    this.port.postMessage(new Float32Array(ch));
                  }
                  return true;
                }
              }
              registerProcessor('liddy-capture-processor', LiddyCaptureProcessor);
            `;
            const blobUrl = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
            workletBlobUrlRef.current = blobUrl;
            await inputCtx.audioWorklet.addModule(blobUrl);

            if (sessionRunIdRef.current !== runId) return;

            const workletNode = new AudioWorkletNode(inputCtx, 'liddy-capture-processor');
            workletNodeRef.current = workletNode;
            workletNode.port.onmessage = (ev: MessageEvent<Float32Array>) => {
              handleAudioSamplesFrame(ev.data, nativeRate, runId);
            };
            source.connect(workletNode);
            workletNode.connect(silentGain);
            silentGain.connect(inputCtx.destination);
            workletAttached = true;
          } catch {
            workletAttached = false;
          }
        }

        if (!workletAttached) {
          try {
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            processor.onaudioprocess = (e) => {
              handleAudioSamplesFrame(e.inputBuffer.getChannelData(0), nativeRate, runId);
            };
            source.connect(processor);
            processor.connect(silentGain);
            silentGain.connect(inputCtx.destination);
          } catch {}
        }
      };

      ws.onmessage = async (event: MessageEvent) => {
        if (sessionRunIdRef.current !== runId) return;
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'audio' && message.audio && audioContextRef.current && outputNodeRef.current) {
            if (audioContextRef.current.state === 'suspended') {
              await audioContextRef.current.resume().catch(() => {});
            }
            const ctx = audioContextRef.current;
            const binaryString = atob(message.audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            const buffer = await decodeAudioData(bytes, ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(outputNodeRef.current);
            source.addEventListener('ended', () => {
              sourcesRef.current.delete(source);
            });
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
            sourcesRef.current.add(source);
          }

          if (message.type === 'interrupted') {
            sourcesRef.current.forEach((s) => {
              try {
                s.stop();
              } catch {}
            });
            sourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }

          if (message.type === 'close' || message.type === 'error') {
            setIsConnected(false);
            setIsConnecting(false);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (sessionRunIdRef.current !== runId) return;
        setIsConnecting(false);
        setIsConnected(false);
      };

      ws.onerror = () => {
        if (sessionRunIdRef.current !== runId) return;
        setIsConnecting(false);
        setIsConnected(false);
      };
    } catch {
      if (sessionRunIdRef.current !== runId) return;
      cleanupAudioGraph();
      setIsConnecting(false);
      setIsConnected(false);
      setPermissionDenied(true);
    }
  }, [cleanupAudioGraph, logAnalyticsEvent, handleAudioSamplesFrame]);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      sessionRunIdRef.current += 1;
      cleanupAudioGraph();
    };
  }, [autoConnect, connect, cleanupAudioGraph]);

  const handleCloseVoice = useCallback(() => {
    disconnect();
    onClose?.();
  }, [disconnect, onClose]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseVoice();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleCloseVoice]);

  return (
    <div
      className="fixed inset-0 z-50 bg-[#05060B] flex items-center justify-center overflow-hidden select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Voice mode"
    >
      {/* Pure Ambient Acoustic Glow */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${
          permissionDenied
            ? 'bg-[radial-gradient(circle_at_50%_50%,rgba(244,63,94,0.16),rgba(17,24,39,0.2)_45%,#05060B_80%)]'
            : 'bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.14),rgba(79,70,229,0.09)_42%,#05060B_78%)]'
        }`}
      />

      {/* ONLY Control: Top-Right Double-Cross Close Sign (Zero Visible Text) */}
      {onClose && (
        <button
          type="button"
          onClick={handleCloseVoice}
          aria-label="Close voice mode"
          className="fixed top-6 right-6 z-50 w-12 h-12 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 text-white flex items-center justify-center transition-all cursor-pointer active:scale-95"
        >
          <svg
            className="w-6 h-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {/* Double-cross closing emblem */}
            <path d="M5 5L19 19M19 5L5 19" opacity="0.95" />
            <path d="M8.5 5L19 15.5M15.5 5L5 15.5" opacity="0.45" />
          </svg>
        </button>
      )}

      {/* Centerpiece Acoustic Sphere + Pure Concentric Halos (Zero Text) */}
      <div className="relative z-10 flex items-center justify-center">
        <div
          className={`absolute rounded-full border pointer-events-none transition-transform duration-150 ${
            permissionDenied ? 'border-rose-400/40' : 'border-sky-400/25'
          }`}
          style={{
            width: '340px',
            height: '340px',
            transform: `scale(${1 + (isConnected ? volume * 0.48 : isConnecting ? 0.08 : 0)})`,
            opacity: isConnected ? 0.65 : permissionDenied ? 0.5 : 0.2,
          }}
        />
        <div
          className={`absolute rounded-full border pointer-events-none transition-transform duration-200 ${
            permissionDenied ? 'border-rose-500/25' : 'border-indigo-400/20'
          }`}
          style={{
            width: '430px',
            height: '430px',
            transform: `scale(${1 + (isConnected ? volume * 0.72 : 0)})`,
            opacity: isConnected ? 0.4 : 0.1,
          }}
        />

        <Voice3DOrb
          volume={volume}
          isConnected={isConnected}
          status=""
          onClick={() => {
            if (isConnected || isConnecting) {
              disconnect();
            } else {
              connect();
            }
          }}
        />
      </div>

      {/* Pure Graphic Acoustic Spectrum Bars (Zero Text) */}
      <div className="fixed bottom-10 inset-x-0 z-20 flex items-center justify-center pointer-events-none">
        <div className="flex items-end gap-1.5 h-8">
          {Array.from({ length: 20 }).map((_, i) => {
            const activeVol = isConnected ? volume : 0;
            const heightPx = Math.max(
              4,
              Math.min(30, activeVol * 85 + Math.abs(Math.sin(i * 0.75)) * (isConnected ? 10 : 3))
            );
            return (
              <div
                key={i}
                className="w-1 rounded-full bg-gradient-to-t from-sky-500/80 via-indigo-400/80 to-fuchsia-400/80 transition-all duration-75"
                style={{
                  height: `${heightPx}px`,
                  opacity: isConnected ? 0.9 : 0.22,
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LiveAdvisor;