// app/api/texttospeech/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@deepgram/sdk';
import { pipe } from '@screenpipe/js';


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, voice = 'aura-asteria-en' } = body;
    const settings = await pipe.settings.getAll();
    const deepgramApiKey = settings.deepgramApiKey || 'bf65c9f898b274f6cb4610f5b0424cf2c801cba5';
    const deepgram = createClient(deepgramApiKey);
    if (!text) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    console.log('Inside the text-to-speech request');

    // Call Deepgram's Text-to-Speech API using the latest SDK
    const response = await deepgram.speak.request(
      { text },
      {
        model: voice,
        encoding: 'linear16',
        container: 'wav',
        sampleRate: 24000
      }
    );

    // Get the audio stream
    const stream = await response.getStream();
    if (!stream) {
      throw new Error('No audio stream received from Deepgram');
    }

    // Convert stream to buffer
    const buffer = await streamToBuffer(stream);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': buffer.byteLength.toString()
      }
    });
  } catch (error: any) {
    console.error('Text-to-speech error:', error);
    return NextResponse.json(
      { error: 'Text-to-speech conversion failed', details: error.message },
      { status: 500 }
    );
  }
}

// Helper function to convert stream to buffer
async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine all chunks into a single Uint8Array
  const dataArray = chunks.reduce(
    (acc, chunk) => {
      const newArray = new Uint8Array(acc.length + chunk.length);
      newArray.set(acc, 0);
      newArray.set(chunk, acc.length);
      return newArray;
    },
    new Uint8Array(0)
  );

  return Buffer.from(dataArray);
}