"use client";

import { SettingsProvider } from "@/lib/settings-provider";
import { ClientOnly } from "@/lib/client-only";
import { Inter } from "next/font/google";
import { useEffect, useState } from "react";
import { DesktopActivityMonitor4 } from "@/components/mentor";

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

interface Pipe {
  id: string;
  name: string;
  description: string;
}

export default function Page() {
  const [pipes, setPipes] = useState<Pipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [audioCommand, setAudioCommand] = useState("");
  const [response, setResponse] = useState("");

  useEffect(() => {
    fetch("https://screenpi.pe/api/plugins/registry")
      .then((res) => res.json())
      .then((data) => {
        const transformedPipes = data.map((pipe: any) => ({
          id: pipe.id,
          name: pipe.name,
          description: pipe.description?.split('\n')[0] || ''
        }));
        setPipes(transformedPipes);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Error fetching pipes:", error);
        setLoading(false);
      });
  }, []);

  const handleAudioCommand = async () => {
    try {
      const res = await fetch("/api/audio-transcription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: audioCommand }),
      });

      const data = await res.json();
      setResponse(data.response || "No response available.");
    } catch (error) {
      console.error("Error sending audio command:", error);
    }
  };

  return (
    <SettingsProvider>
      <ClientOnly>
        <div className={`${inter.className} min-h-screen bg-slate-50 dark:bg-slate-900 p-4`}>
          <div className="max-w-7xl mx-auto">
            {/* Header Section */}
            <div className="text-center mb-8 pt-4">
              <h1 className="text-4xl font-bold mb-2">Jarvis - Your Personal Assistant</h1>
              <p className="text-gray-600">An AI assistant that monitors your screen and helps you in real time.</p>
            </div>

            {/* Main Component */}
            <DesktopActivityMonitor4 />
          </div>
        </div>
      </ClientOnly>
    </SettingsProvider>
  );
}