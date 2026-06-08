import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "unsupported" | "idle" | "listening" | "error";

function getRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * Speech-to-text into a text field via the Web Speech API.
 * Transcript is appended to whatever was in the field when recording started.
 * Degrades to an "unsupported" state when the API is missing (e.g. some
 * packaged Electron builds ship without a speech backend).
 */
export function useVoiceInput(props: {
  value: string;
  onChange(value: string): void;
}) {
  const supported = typeof getRecognitionCtor() !== "undefined";
  const [state, setState] = useState<VoiceState>(supported ? "idle" : "unsupported");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const baseValueRef = useRef("");
  const finalRef = useRef("");
  // Always-current value so onresult appends to the latest base text.
  const valueRef = useRef(props.value);
  valueRef.current = props.value;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setState("unsupported");
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.continuous = true;

    baseValueRef.current = valueRef.current ? `${valueRef.current} ` : "";
    finalRef.current = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalRef.current += transcript;
        } else {
          interim += transcript;
        }
      }
      props.onChange(baseValueRef.current + finalRef.current + interim);
    };

    recognition.onerror = () => {
      setState("error");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setState("idle");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setState("listening");
    } catch {
      recognitionRef.current = null;
      setState("error");
    }
  }, [props]);

  const toggle = useCallback(() => {
    if (state === "unsupported") {
      return;
    }
    if (state === "listening") {
      stop();
    } else {
      start();
    }
  }, [state, start, stop]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { state, toggle };
}
