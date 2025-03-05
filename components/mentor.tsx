/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import { useEffect, useState, useRef } from "react";
import { pipe, VisionEvent, type ContentItem, type OCRContent, type UiContent } from "@screenpipe/browser";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Eye, Layout, Clipboard, X, RefreshCw, Play, Square, StopCircle } from "lucide-react";
import { useSettings } from "@/lib/settings-provider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from "next/image";
import { LiveAudioVisualizer } from "react-audio-visualize";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { motion } from "framer-motion";
import { StepsAndCodeEditor } from "./StepsAndCodeEditor";
import { usePipeSettings } from "@/lib/hooks/use-pipe-settings";


interface DesktopContext {
  vision: {
    latest: OCRContent | null;
    realtime: VisionEvent | null;
    buffer: Array<{ data: VisionEvent; timestamp: string }>;
  };
  ui: {
    latest: UiContent | null;
  };
  conversation: Array<{
    role: "user" | "assistant";
    text: string;
    timestamp: string;
  }>;
  userInstruction: string;
  timestamp: string;
}

interface AssistantResponse {
  text: string;
  timestamp: string;
  details?: {
    steps?: string[];
    code?: string;
    type: 'steps' | 'code' | 'none';
  };
}

export function DesktopActivityMonitor4({
  refreshInterval = 10000,
  inactivityTimeout = 5000,
  maxContextItems = 10,
  maxVisionBufferItems = 5,
}: {
  refreshInterval?: number;
  inactivityTimeout?: number;
  maxContextItems?: number;
  maxVisionBufferItems?: number;
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [context, setContext] = useState<DesktopContext>({
    vision: { latest: null, realtime: null, buffer: [] },
    ui: { latest: null },
    conversation: [],
    userInstruction: "",
    timestamp: new Date().toISOString()
  });

  const { settings } = useSettings();
  // Voice interaction states
  const [isListening, setIsListening] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [assistantResponses, setAssistantResponses] = useState<AssistantResponse[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);


  // Refs
  const microphoneRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const visualizerRef = useRef<any>(null);
  const visionStreamRef = useRef<any>(null);
  const deepgramLiveRef = useRef<any>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptBufferRef = useRef<string>("");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Settings
  const [streamVision, setStreamVision] = useState(true);
  const [includeImages, setIncludeImages] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [contextSize, setContextSize] = useState(maxContextItems);

  const updateError = (source: string, message: string | null) => {
    setErrors(prev => ({ ...prev, [source]: message }));
  };

  const updateContext = (
    type: 'vision' | 'vision-realtime' | 'ui' | 'userInstruction' | 'conversation',
    data: any
  ) => {
    setContext(prev => {
      const newState: DesktopContext = {
        ...prev,
        timestamp: new Date().toISOString(),
        vision: {
          ...prev.vision,
          realtime: type === 'vision-realtime' ? data : prev.vision.realtime,
          buffer: type === 'vision-realtime' ? prev.vision.buffer : prev.vision.buffer,
          latest: type === 'vision' ? data : prev.vision.latest,
        },
        ui: {
          latest: type === 'ui' ? data : prev.ui.latest,
        },
        conversation: type === 'conversation' ? [
          ...prev.conversation,
          {
            role: type === 'conversation' ? data.role : prev.conversation[prev.conversation.length - 1].role,
            text: type === 'conversation' ? data.text : prev.conversation[prev.conversation.length - 1].text,
            timestamp: new Date().toISOString(),
          },
        ].slice(-maxContextItems) : prev.conversation,
        userInstruction: type === 'userInstruction' ? data : prev.userInstruction,
      };

      return newState;
    });
  };

  const clearContext = () => {
    setContext({
      vision: { latest: null, realtime: null, buffer: [] },
      ui: { latest: null },
      conversation: [],
      userInstruction: "",
      timestamp: new Date().toISOString()
    });
    setAssistantResponses([]);
  };

  const fetchLatestOCR = async () => {
    try {
      updateError('vision', null);
      const result = await pipe.queryScreenpipe({
        contentType: "all",
        limit: 10,
      });

      if (!result?.data?.length) {
        updateError('vision', "No OCR data available");
        return;
      }

      const items = result.data as (ContentItem & { type: "OCR" })[];

      // Map through each item and update the context
      items.forEach((item) => {
        if (item.type === "OCR") {
          updateContext('vision', {
            text: item.content.text,
            frame: item.content.frame,
            timestamp: item.content.timestamp,
          });
        }
      });
    } catch (error) {
      updateError('vision', error instanceof Error ? error.message : "Failed to fetch OCR data");
    }
  };

  const fetchAlldata = async () => {
    const minutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    try {
      const result = await pipe.queryScreenpipe({
        startTime: minutesAgo,
        contentType: "all",
        limit: 15,
      });

      // Separate different types of content
      const ocrData = (result?.data || [])
        .filter((item): item is ContentItem & { type: "OCR" } => item.type === "OCR")
        .map(item => ({
          text: item.content.text,
          timestamp: item.content.timestamp
        }));

      const uiData = (result?.data || [])
        .filter((item): item is ContentItem & { type: "UI" } => item.type === "UI")
        .map(item => ({
          elements: item.content.text,
          timestamp: item.content.timestamp
        }));

      const activeWindowData = (result?.data || [])
        .filter((item: any) => item.type === "WINDOW")
        .map(item => ({
          title: (item.content as any)?.title || 'Unknown',
          application: (item.content as any)?.application || 'Unknown',
          timestamp: (item.content as any)?.timestamp || new Date().toISOString()
        }));

      return {
        ocr: ocrData,
        ui: uiData,
        activeWindow: activeWindowData
      };
    } catch (error) {
      updateError('vision', error instanceof Error ? error.message : "Failed to fetch data");
      return null;
    }
  };



  const fetchAllLatest = async () => {
    await Promise.all([fetchLatestOCR(), fetchAlldata()]);
  };

  const startVisionStream = async () => {
    try {
      updateError('vision-realtime', null);
      const stream = pipe.streamVision(true);
      visionStreamRef.current = stream;

      for await (const event of stream) {
        if (event.data?.text) {
          if (!includeImages) event.data.image = "";
          updateContext('vision-realtime', event.data);
        }
      }
    } catch (error) {
      updateError('vision-realtime', error instanceof Error ? error.message : "Failed to stream vision");
    }
  };

  const startStreaming = async () => {
    setIsStreaming(true);
    if (streamVision) startVisionStream();
    await fetchAllLatest();
  };

  const stopStreaming = () => {
    visionStreamRef.current?.return?.();
    setIsStreaming(false);
  };

  /*   const processWithGemini = async (userInstruction: string) => {
      try {
        setIsProcessing(true);
  
        // Fetch all latest data with enhanced context
        const allData = await fetchAlldata();
        if (!allData) throw new Error('Failed to fetch context data');
  
        // Log context data to verify freshness
        const timestamp = new Date().toISOString();
        const contextDebug = {
          timestamp,
          contextData: allData,
          instruction: userInstruction
        };
  
        // Log to console instead of writing to file
        console.log('Debug Context:', contextDebug);
  
        const promptContext = {
          ocr: allData.ocr,
          ui: allData.ui,
          activeWindow: allData.activeWindow,
          conversationHistory: context.conversation
        };
  
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            screenContext: promptContext,
            userInstruction
          })
        });
  
        if (!response.ok) throw new Error('Generation failed');
        const result = await response.json();
  
        if (result.reply) {
          const assistantResponse = {
            text: result.reply,
            timestamp: new Date().toISOString()
          };
  
          // Update assistant responses for UI
          setAssistantResponses(prev => [...prev, assistantResponse]);
  
          // Store assistant response in conversation context
          updateContext('conversation', {
            role: "assistant",
            text: result.reply,
            timestamp: new Date().toISOString()
          });
  
          await speakResponse(result.reply);
        }
      } catch (error) {
        updateError('gemini', error instanceof Error ? error.message : "Processing failed");
      } finally {
        setIsProcessing(false);
      }
    }; */

  const processWithOpenAI = async (userInstruction: string) => {
    try {
      setIsProcessing(true);
      const allData = await fetchAlldata();
      if (!allData) throw new Error('Failed to fetch context data');
      console.log(allData);

      const promptContext = {
        ocr: allData.ocr,
        ui: allData.ui,
        activeWindow: allData.activeWindow,
        conversationHistory: context.conversation
      };

      const response = await fetch('/api/generateopenai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          screenContext: promptContext,
          userInstruction
        })
      });

      if (!response.ok) throw new Error('Generation failed');
      const result = await response.json();

      if (result.speech) {
        const assistantResponse = {
          text: result.speech,
          timestamp: new Date().toISOString(),
          details: result.details
        };

        setAssistantResponses(prev => [...prev, assistantResponse]);
        updateContext('conversation', {
          role: "assistant",
          text: result.speech,
          timestamp: new Date().toISOString()
        });

        await speakResponse(result.speech);
      }
    } catch (error) {
      updateError('openai', error instanceof Error ? error.message : "Processing failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const clearResponses = () => {
    setAssistantResponses([]);
    setUserMessage("");
    setContext(prev => ({
      ...prev,
      conversation: [],
      userInstruction: ""
    }));
  };

  const speakResponse = async (text: string) => {
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
        setIsPlaying(false);
      }

      setIsPlaying(true);
      const response = await fetch('/api/texttospeech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
      };

      await audio.play();
    } catch (error) {
      updateError('tts', error instanceof Error ? error.message : "Speech failed");
      setIsPlaying(false);
    }
  };

  const processInactiveTranscript = async () => {
    if (transcriptBufferRef.current.trim()) {
      const finalTranscript = transcriptBufferRef.current.trim();
      setUserMessage(finalTranscript);
      updateContext('userInstruction', finalTranscript);
      transcriptBufferRef.current = "";
      setCurrentTranscript("");
      await processWithOpenAI(finalTranscript);
    }
  };

  const resetInactivityTimer = () => {
    inactivityTimerRef.current && clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(processInactiveTranscript, inactivityTimeout);
  };
  const settingsData = usePipeSettings();
  const startLiveTranscription = async () => {

    try {
      updateError('voice', null);
      setIsListening(true);
      setUserMessage("");
      setCurrentTranscript("");
      transcriptBufferRef.current = "";

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = audioContextRef.current;
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      visualizerRef.current = { analyser, source };

      const deepapi = settingsData.settings?.screenpipeAppSettings?.deepgramApiKey;
      const deepgram = createClient(deepapi);
      const live = deepgram.listen.live({
        model: "nova-3",
        smart_format: true,
        interim_results: true,
        punctuate: true,
      });

      deepgramLiveRef.current = live;

      live.on(LiveTranscriptionEvents.Open, () => {
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.addEventListener("dataavailable", event => {
          if (event.data.size > 0 && live.getReadyState() === 1) {
            live.send(event.data);
          }
        });
        mediaRecorder.start(250);
        microphoneRef.current = mediaRecorder;
      });

      live.on(LiveTranscriptionEvents.Transcript, (data) => {
        const transcript = data.channel.alternatives[0]?.transcript || "";
        if (transcript) {
          if (currentAudioRef.current) {
            currentAudioRef.current.pause();
            currentAudioRef.current = null;
            setIsPlaying(false);
          }

          if (!data.is_final) {
            setCurrentTranscript(transcript);
          } else {
            transcriptBufferRef.current += " " + transcript;
            setCurrentTranscript(prev => prev + " " + transcript);
            resetInactivityTimer();
          }
        }
      });

      live.on(LiveTranscriptionEvents.Error, updateError);
      resetInactivityTimer();
    } catch (error) {
      updateError('voice', error instanceof Error ? error.message : "Transcription failed");
      setIsListening(false);
    }
  };

  const stopLiveTranscription = async () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
      setIsPlaying(false);
    }

    if (microphoneRef.current?.state !== "inactive") {
      microphoneRef.current?.stop();
    }

    deepgramLiveRef.current?.requestClose?.();
    deepgramLiveRef.current = null;

    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    if (visualizerRef.current) {
      visualizerRef.current.source.disconnect();
      visualizerRef.current = null;
    }

    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;

    setIsListening(false);
    await processInactiveTranscript();
  };

  // Function to update context with real-time data


  // Call this function at regular intervals




  useEffect(() => {
    if (autoRefresh && isStreaming) {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
      }

      autoRefreshTimerRef.current = setInterval(() => {
        fetchAllLatest();
      }, refreshInterval);
    } else if (!autoRefresh && autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current);
      autoRefreshTimerRef.current = null;
    }

    return () => {
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
      }
    };
  }, [autoRefresh, isStreaming, refreshInterval]);

  // Clean up streams when component unmounts
  useEffect(() => {
    return () => {
      stopStreaming();
      stopLiveTranscription();
      if (autoRefreshTimerRef.current) {
        clearInterval(autoRefreshTimerRef.current);
      }
    };
  }, []);

  const renderContextSummary = ({ context }: { context: any }) => {
    const hasVision = !!context.vision.latest || !!context.vision.realtime
    const hasUI = !!context.ui.latest

    return (
      <div className="space-y-2 border rounded-md p-3 bg-slate-50">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Context Summary</h3>
          <span className="text-xs text-slate-500">Last updated: {new Date(context.timestamp).toLocaleTimeString()}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={hasVision ? "default" : "outline"} className="text-xs">
            Vision {hasVision ? "✓" : "✗"}
          </Badge>
          <Badge variant={hasUI ? "default" : "outline"} className="text-xs">
            UI {hasUI ? "✓" : "✗"}
          </Badge>
        </div>

        <div className="text-xs text-slate-600">
          {hasVision && (
            <div>
              <span className="font-semibold">Vision: </span>
              {context.vision.realtime
                ? `${context.vision.realtime.text?.slice(0, 100) || ""}...`
                : context.vision.latest?.text.slice(0, 100) + "..."}
            </div>
          )}

          {hasUI && (
            <div>
              <span className="font-semibold">UI: </span>
              {context.ui.latest?.text.slice(0, 100)}...
            </div>
          )}
        </div>
      </div>
    )
  }
  const renderAssistantConversation = ({
    isListening,
    isProcessing,
    isPlaying,
    currentTranscript,
    userMessage,
    assistantResponses,
    startLiveTranscription,
    stopLiveTranscription,
  }: {
    isListening: boolean
    isProcessing: boolean
    isPlaying: boolean
    currentTranscript: string | null
    userMessage: string | null
    assistantResponses: any[]
    startLiveTranscription: () => void
    stopLiveTranscription: () => void
  }) => {
    return (
      <div className="space-y-4 mt-3 max-h-[600px] overflow-hidden flex flex-col">
        <span className="text-md font-semibold">How can I help you?</span>

        {/* Centered motion button */}
        <div className="flex flex-col items-center justify-center py-2">
          <motion.div
            className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-black flex items-center justify-center text-white shadow-lg cursor-pointer relative overflow-hidden"
            animate={
              isListening
                ? {
                  scale: [1, 1.05, 1],
                  rotate: [0, 2, -2, 0],
                  y: [0, -5, 0],
                  boxShadow: [
                    "0px 0px 0px rgba(0,0,0,0.2)",
                    "0px 10px 20px rgba(56, 189, 248, 0.6)",
                    "0px 0px 0px rgba(0,0,0,0.2)",
                  ],
                }
                : {
                  y: [0, -8, 0],
                  transition: {
                    duration: 3,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  },
                }
            }
            transition={{
              duration: 1.5,
              repeat: isListening ? Number.POSITIVE_INFINITY : 0,
              ease: "easeInOut",
            }}
            onClick={isListening ? undefined : startLiveTranscription}
            whileHover={{ scale: 1.1, boxShadow: "0px 10px 25px rgba(56, 189, 248, 0.7)" }}
            whileTap={{ scale: 0.92 }}
          >
            {/* Background shape morphing */}
            <motion.div
              className="absolute inset-0 rounded-full bg-black opacity-30"
              animate={{
                borderRadius: ["50%", "45%", "50%", "55%", "50%"],
                scale: [1, 1.03, 0.98, 1.02, 1],
              }}
              transition={{ duration: 8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />

            {/* Ripple effect when listening */}
            {isListening && (
              <>
                <motion.div
                  className="absolute inset-0 rounded-full bg-white opacity-20"
                  initial={{ scale: 0 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
                />
                <motion.div
                  className="absolute inset-0 rounded-full bg-white opacity-20"
                  initial={{ scale: 0 }}
                  animate={{ scale: 2, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY, delay: 0.5 }}
                />
              </>
            )}

            <span className="text-lg md:text-base font-light z-10">
              {isProcessing ? "Processing" : isPlaying ? "Speaking" : isListening ? "Listening" : "Speak"}
            </span>
          </motion.div>

          <div className="mt-2 text-center">
            {/* Small stop button when recording */}
            {isListening && (
              <Button
                onClick={stopLiveTranscription}
                variant="outline"
                size="sm"
                className="mt-1 border-red-300 text-red-600 hover:bg-red-50 rounded-full px-3"
              >
                <StopCircle className="h-3 w-3 mr-1" />
                Stop
              </Button>
            )}
          </div>
        </div>

        {/* Transcript and conversation container with fixed height */}
        <div className="flex-1 min-h-0 flex flex-col space-y-2 overflow-hidden">
          {/* Current transcript (showing while speaking) */}
          {isListening && currentTranscript && (
            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 shadow-sm max-h-20 overflow-y-auto">
              <p className="text-xs font-medium text-slate-700 mb-1">Current transcript:</p>
              <p className="text-xs text-slate-600">{currentTranscript}</p>
            </div>
          )}

          {/* Last processed message */}
          {!isListening && userMessage && (
            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 shadow-sm max-h-20 overflow-y-auto">
              <p className="text-xs font-medium text-slate-700 mb-1">You asked:</p>
              <p className="text-xs text-slate-600">{userMessage}</p>
            </div>
          )}

          {/* Conversation history - fixed height */}
          <div className="rounded-lg border border-slate-200 shadow-sm overflow-hidden flex-1 min-h-0">
            <ScrollArea className="h-[250px]">
              {assistantResponses.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-slate-400">
                  <p className="text-sm">No conversation yet</p>
                  <p className="text-xs mt-1">Tap the button above to start talking</p>
                </div>
              ) : (
                <div className="p-3 space-y-3">
                  {assistantResponses.map((response, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-3 border-l-4 border-blue-400"
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-medium text-blue-700">Assistant</span>
                        <span className="text-xs text-slate-500">
                          {new Date(response.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">{response.text}</p>
                      <ResponseDetails details={response.details} />
                    </motion.div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-center items-start gap-4">
      {/* Main card with context and conversation */}
      <Card className="max-w-md w-full max-h-[700px] overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center justify-between">
            <span>Welcome back!</span>
            {isStreaming ? <Badge className="ml-2 animate-pulse">Live</Badge> : null}
          </CardTitle>

          <div className="flex flex-wrap gap-2 mt-1">
            <div className="flex items-center space-x-1">
              <Switch
                id="vision-switch"
                checked={streamVision}
                onCheckedChange={setStreamVision}
                disabled={isStreaming}
              />
              <Label htmlFor="vision-switch" className="flex items-center text-xs">
                <Eye className="h-3 w-3 mr-1" /> Vision
              </Label>
            </div>

            <div className="flex items-center space-x-1">
              <Switch
                id="images-switch"
                checked={includeImages}
                onCheckedChange={setIncludeImages}
                disabled={isStreaming}
              />
              <Label htmlFor="images-switch" className="flex items-center text-xs">
                Include Images
              </Label>
            </div>

            <div className="flex items-center space-x-1">
              <Switch id="auto-refresh-switch" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <Label htmlFor="auto-refresh-switch" className="flex items-center text-xs">
                <RefreshCw className="h-3 w-3 mr-1" /> Auto
              </Label>
            </div>
          </div>
        </CardHeader>

        <CardContent className="overflow-y-auto max-h-[calc(700px-80px)]">
          <div className="flex flex-wrap gap-2 mb-3">
            <Button
              onClick={isStreaming ? stopStreaming : startStreaming}
              variant={isStreaming ? "destructive" : "default"}
              className="flex items-center text-xs py-1 h-8"
              size="sm"
            >
              {isStreaming ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Stop Monitoring
                </>
              ) : (
                "Start Monitoring"
              )}
            </Button>

            <Button
              onClick={fetchAllLatest}
              variant="outline"
              disabled={!isStreaming}
              className="text-xs py-1 h-8"
              size="sm"
            >
              Refresh
            </Button>

            <Button
              onClick={clearContext}
              disabled={!isStreaming}
              variant="outline"
              className="text-xs py-1 h-8"
              size="sm"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>

          {renderContextSummary({ context })}

          {isStreaming &&
            renderAssistantConversation({
              isListening,
              isProcessing,
              isPlaying,
              currentTranscript,
              userMessage,
              assistantResponses,
              startLiveTranscription,
              stopLiveTranscription,
            })}

          {/* Display any errors not already handled */}
          {Object.entries(errors)
            .filter(([key, value]) => value && !["vision", "vision-realtime", "ui"].includes(key))
            .map(([key, value]) => (
              <p key={key} className="text-xs text-red-500 mt-2">
                {value}
              </p>
            ))}
        </CardContent>
      </Card>

      {/* StepsAndCodeEditor on the right side */}
      {isStreaming && (
        <div className="hidden md:block w-full max-w-md">
          <Card className="h-[700px] overflow-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Steps & Code Editor</CardTitle>
            </CardHeader>
            <CardContent>
              <StepsAndCodeEditor assistantResponses={assistantResponses} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Mobile view for StepsAndCodeEditor - only shows on small screens */}
      {isStreaming && (
        <div className="md:hidden w-full mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Steps & Code Editor</CardTitle>
            </CardHeader>
            <CardContent>
              <StepsAndCodeEditor assistantResponses={assistantResponses} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

const ResponseDetails = ({ details }: { details: AssistantResponse['details'] }) => {
  if (!details || details.type === 'none') return null;

  return (
    <div className="mt-2 border-t border-slate-200 pt-2">
      {details.type === 'steps' && details.steps && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-600">Steps to follow:</p>
          <ol className="list-decimal list-inside space-y-1">
            {details.steps.map((step, index) => (
              <li key={index} className="text-xs text-slate-600">{step}</li>
            ))}
          </ol>
        </div>
      )}
      {details.type === 'code' && details.code && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-600">Code:</p>
          <pre className="text-xs bg-slate-100 p-2 rounded overflow-x-auto">
            <code>{details.code}</code>
          </pre>
        </div>
      )}
    </div>
  );
};