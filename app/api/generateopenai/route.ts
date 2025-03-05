import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { pipe } from "@screenpipe/js";

export async function POST(request: Request) {
  try {
    // Get API key from settings
    const settings = await pipe.settings.getAll();
    const gptApi = settings.openaiApiKey;

    if (!gptApi) {
      return NextResponse.json(
        { error: "API key missing" },
        { status: 400 }
      );
    }

    // Initialize OpenAI with the API key from settings
    const openai = new OpenAI({
      apiKey: gptApi,
    });

    const body = await request.json();
    const { screenContext, userInstruction } = body;

    if (!userInstruction) {
      return NextResponse.json(
        { error: 'User instruction is required' },
        { status: 400 }
      );
    }

    // Create enhanced context-aware prompt for OpenAI
    const contextPrompt = `
    You are an intelligent AI assistant, similar to J.A.R.V.I.S. from Iron Man. Your purpose is to assist the user with their tasks using natural, conversational language.
    
    The user's current screen activity includes:

    Active Application/Window:
    ${screenContext?.activeWindow?.[0]?.title || 'Unknown'} 
    Running in: ${screenContext?.activeWindow?.[0]?.application || 'Unknown application'}
    
    Current Screen Content (OCR):
    ${screenContext?.ocr?.[0]?.text || 'No visible text detected'}
    Recent Screen History (last 2 minutes):
    ${screenContext?.ocr?.slice(0, 10).map((entry: { text: string }, index: number) =>
      `[${index + 1} moments ago]: ${entry.text.slice(0, 400)}...`
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

    // Update the system message and prompt to be more explicit about code handling
    const systemPrompt = `
    You are a helpful AI coding assistant (J.A.R.V.I.S.) that provides responses in JSON format.
    When users ask for code or programming help:
    1. Always provide actual code snippets, not just descriptions
    2. Include both explanation in speech and the actual code
    3. Use the "code" field for code snippets
    4. Set type to "code" when providing code
    5. Format code properly with appropriate syntax

    When users ask for steps or instructions:
    1. Use the "steps" field for step-by-step guidance
    2. Set type to "steps"

    Always return a valid JSON response with either code or steps based on the user's request.
    `;

    const fullPrompt = `
    ${contextPrompt}
    
    ${generalPrompt}
    
    The user has asked: "${userInstruction}"
    
    Please provide your response in the following JSON structure:
    {
      "speech": "A natural, conversational response under 100 words",
      "details": {
        "steps": ["Step 1...", "Step 2...", ...] (only if providing instructions),
        "code": "complete code snippet with proper formatting" (required for any coding-related queries),
        "type": "steps|code|none" (use "code" for any programming-related requests)
      }
    }
    
    Important:
    - If the user asks what is on the screen, then respond with the correct answer
    - If the user asks for code, ALWAYS provide actual code in the "code" field
    - Keep speech concise and conversational
    - Provide complete, working code snippets, not pseudocode
    - Use proper code formatting and syntax
    - If the query is code-related, set type to "code" and include both explanation and code
    `;

    // Update the OpenAI call with the new system prompt
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        { role: "user", content: fullPrompt }
      ],
      model: "gpt-3.5-turbo",
      max_tokens: 1000, // Increased to allow for longer code snippets
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0]?.message?.content || "{}";
    const parsedResponse = JSON.parse(responseText);

    // Log and return response
    console.log('Generated Response:', parsedResponse);
    return NextResponse.json(parsedResponse);
  } catch (error) {
    console.error('Error generating response:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 