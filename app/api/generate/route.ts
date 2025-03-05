import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI("your-gemini-api-key");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { screenContext, userInstruction } = body;

    if (!userInstruction) {
      return NextResponse.json(
        { error: 'User instruction is required' },
        { status: 400 }
      );
    }

    // Create enhanced context-aware prompt for Gemini
    const contextPrompt = `
    You are an intelligent AI assistant, similar to J.A.R.V.I.S. from Iron Man. Your purpose is to assist the user with their tasks using natural, conversational language.
    
    The user's current screen activity includes:

    Active Application/Window:
    ${screenContext?.activeWindow?.[0]?.title || 'Unknown'} 
    Running in: ${screenContext?.activeWindow?.[0]?.application || 'Unknown application'}
    
    Current Screen Content (OCR):
    ${screenContext?.ocr?.[0]?.text || 'No visible text detected'}
    Recent Screen History (last 2 minutes):
    ${screenContext?.ocr?.slice(0, 3).map((entry: { text: string }, index: number) =>
      `[${index + 1} moments ago]: ${entry.text.slice(0, 200)}...`
    ).join('\n') || 'No recent history'}
    
    UI Elements Present:
    ${screenContext?.ui?.[0]?.elements || 'No UI elements detected'}
    
    Previous UI Interactions:
    ${screenContext?.ui?.slice(1, 3).map((entry: { elements: string }, index: number) =>
      `[${index + 1} moments ago]: ${entry.elements.slice(0, 200)}...`
    ).join('\n') || 'No previous UI interactions'}
    `;

    // Create general instruction handling
    const generalPrompt = `
    If the user's question is not related to their current screen context, respond as a helpful AI assistant. 
    You can answer general questions, provide information, or assist with various topics.
    
    When responding to screen-related queries:
    1. Reference the active application/window if relevant
    2. Use the OCR text to understand what the user is looking at
    3. Consider UI elements when suggesting interactions
    4. Use the screen history to provide context-aware assistance
    `;

    // Combine prompts with instruction
    const fullPrompt = `
    ${contextPrompt}
    
    ${generalPrompt}
    
    The user has asked: "${userInstruction}"
    
    Please respond appropriately based on whether the question relates to the screen context or is a general inquiry.
    Use a natural, conversational tone and provide helpful responses in either case.
    Strictly keep the response below 100 words.
    `;

    // Generate response with Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    const response = await model.generateContent(fullPrompt);
    const result = await response.response;

    // Log and return response
    console.log('Generated Response:', result.text());
    return NextResponse.json({ reply: result.text() });
  } catch (error) {
    console.error('Error generating response:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}