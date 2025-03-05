import { createClient } from '@deepgram/sdk';
import { NextResponse } from 'next/server';
import { pipe } from "@screenpipe/js";


export async function POST(request: Request) {
  try {
    const settings = await pipe.settings.getAll();
    const deepgramApiKey = settings.deepgramApiKey;
    const deepgram = createClient(deepgramApiKey);
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Audio file is required' },
        { status: 400 }
      );
    }

    // Convert the file to a buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Transcribe using Deepgram
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
      buffer,
      {
        smart_format: true,
        model: 'nova-2',
        language: 'en',
        mimetype: audioFile.type || 'audio/wav',
      }
    );

    if (error) {
      throw error;
    }

    // Extract the transcript
    const transcript = result?.results?.channels[0]?.alternatives[0]?.transcript || '';

    return NextResponse.json({ transcript });
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}