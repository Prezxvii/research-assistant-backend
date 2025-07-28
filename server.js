// research-assistant-backend/server.js
require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch').default; // Ensure node-fetch is installed (npm install node-fetch@2 if using older Node.js, otherwise built-in fetch can be used in newer Node.js versions)

const app = express();
const PORT = process.env.PORT || 5000; // Default to port 5000

// Middleware
app.use(cors()); // Enable CORS for all requests from the frontend
app.use(express.json()); // Enable parsing of JSON request bodies

// --- Common API Constants (Defined once for clarity and easier updates) ---
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'; // CORRECTED URL
const MODEL_TO_USE = 'openai/gpt-3.5-turbo'; // Or 'openai/gpt-4o' if you prefer for better results

// Helper function to check for API Key presence
const checkApiKey = (res) => {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    console.error("OpenRouter API Key not set in environment variables! Check .env file and server restart.");
    res.status(500).json({ error: 'Server configuration error: API Key missing.' });
    return false;
  }
  return OPENROUTER_API_KEY;
};

// --- API Route for Search ---
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Search query is required.' });
  }

  const OPENROUTER_API_KEY = checkApiKey(res);
  if (!OPENROUTER_API_KEY) return; // Exit if API key is missing

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_TO_USE,
        messages: [
          {
            role: 'system',
            content: `You are an AI research assistant. When asked a query, provide 2-3 concise, fictional search result-like summaries. Each summary should include a "title", "source" (e.g., Journal, Institute, Blog, Year), and a brief "snippet" (2-3 sentences). Present this data as a JSON array of objects. DO NOT include any conversational text outside the JSON.`,
          },
          {
            role: 'user',
            content: query,
          },
        ],
        temperature: 0.7, // Allows some creativity in generated results
        max_tokens: 500, // Enough tokens for 2-3 summaries
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenRouter API responded with an error (search):', errorData);
      return res.status(response.status).json({
        error: `OpenRouter API error: ${response.statusText}`,
        details: errorData.message || 'Unknown error from OpenRouter',
      });
    }

    const data = await response.json();
    let fetchedResults = [];

    if (data && data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
      const rawContent = data.choices[0].message.content;
      try {
        // Attempt to clean and parse the JSON string (models sometimes wrap in ```json)
        const jsonString = rawContent.replace(/^```json\s*|```\s*$/g, '').trim();
        fetchedResults = JSON.parse(jsonString);
        // Ensure each item has an 'id' for React keys
        fetchedResults = fetchedResults.map((item, index) => ({ ...item, id: item.id || index + 1 }));
      } catch (jsonParseError) {
        console.error("Backend failed to parse OpenRouter search response as JSON:", jsonParseError);
        // Fallback for AI response that isn't perfectly valid JSON
        fetchedResults = [
          {
            id: 1,
            title: `AI Could Not Parse Results for "${query}" (Backend Error)`,
            source: `OpenRouter API Parsing Issue, ${new Date().getFullYear()}`,
            snippet: `The AI responded, but its output could not be formatted as expected by the backend. Raw response (truncated): ${rawContent.substring(0, Math.min(rawContent.length, 200))}...`,
          },
        ];
      }
    } else {
      // Fallback if AI provides no content at all
      fetchedResults = [
        {
          id: 1,
          title: `No Relevant AI Response for "${query}" (Backend Search)`,
          source: `OpenRouter API, ${new Date().getFullYear()}`,
          snippet: 'The AI did not provide any content for your search query via the backend.',
        },
      ];
    }
    res.json({ results: fetchedResults });

  } catch (error) {
    console.error("Error in backend /api/search:", error);
    res.status(500).json({
      error: 'Failed to fetch search results from OpenRouter.',
      details: error.message,
    });
  }
});

// --- API Route for Extraction ---
app.post('/api/extract', async (req, res) => {
  const { textToExtract } = req.body;
  if (!textToExtract) {
    return res.status(400).json({ error: 'Text to extract is required.' });
  }

  const OPENROUTER_API_KEY = checkApiKey(res);
  if (!OPENROUTER_API_KEY) return; // Exit if API key is missing

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_TO_USE,
        messages: [
          {
            role: 'system',
            content: `You are an AI assistant specialized in extracting key information and structuring it into a concise outline. Format the outline using bullet points and sub-bullet points. Do NOT include any conversational text, only the outline.`,
          },
          {
            role: 'user',
            content: `Create a concise outline from the following text:\n\n${textToExtract}`,
          },
        ],
        temperature: 0.3, // Lower temperature for more factual/direct extraction
        max_tokens: 300, // Enough tokens for a typical outline
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenRouter API responded with an error (extract):', errorData);
      return res.status(response.status).json({
        error: `OpenRouter API error during extraction: ${response.statusText}`,
        details: errorData.message || 'Unknown error from OpenRouter',
      });
    }

    const data = await response.json();
    if (data && data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
      const outlineContent = data.choices[0].message.content;
      res.json({ outline: outlineContent }); // Send the generated outline back to the frontend
    } else {
      res.status(500).json({ error: 'AI did not provide outline content.' });
    }

  } catch (error) {
    console.error("Error in backend /api/extract:", error);
    res.status(500).json({
      error: 'Failed to generate outline from OpenRouter.',
      details: error.message,
    });
  }
});

// --- API Route for Insight Generation ---
app.post('/api/insight', async (req, res) => {
  const { textForInsight } = req.body; // Expect the text for which to generate an insight

  if (!textForInsight) {
    return res.status(400).json({ error: 'Text for insight is required.' });
  }

  const OPENROUTER_API_KEY = checkApiKey(res);
  if (!OPENROUTER_API_KEY) return; // Exit if API key is missing

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_TO_USE,
        messages: [
          {
            role: 'system',
            content: `You are an AI research assistant. Given a piece of text, identify the most significant, non-obvious, and actionable insight. Frame it as a concise, thought-provoking statement or a short paragraph. Do NOT include any conversational text outside of the insight itself.`,
          },
          {
            role: 'user',
            content: `Generate a key insight from the following text:\n\n${textForInsight}`,
          },
        ],
        temperature: 0.7, // Allow for some creativity in insight generation
        max_tokens: 150,  // Keep insights concise
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenRouter API responded with an error (insight):', errorData);
      return res.status(response.status).json({
        error: `OpenRouter API error during insight generation: ${response.statusText}`,
        details: errorData.message || 'Unknown error from OpenRouter',
      });
    }

    const data = await response.json();
    if (data && data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
      const insightContent = data.choices[0].message.content;
      res.json({ insight: insightContent }); // Send the generated insight back to the frontend
    } else {
      res.status(500).json({ error: 'AI did not provide insight content.' });
    }

  } catch (error) {
    console.error("Error in backend /api/insight:", error);
    res.status(500).json({
      error: 'Failed to generate insight from OpenRouter.',
      details: error.message,
    });
  }
});

// --- API Route for Form Population ---
app.post('/api/populate_form', async (req, res) => {
  const { sourceText, questions } = req.body;

  if (!sourceText || !questions || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Source text and a list of questions are required.' });
  }

  const OPENROUTER_API_KEY = checkApiKey(res);
  if (!OPENROUTER_API_KEY) return; // Exit if API key is missing

  try {
    // Construct a detailed prompt for the AI to extract specific information
    const prompt = `Based on the following source text, answer each of the following questions concisely. Provide only the answer for each question, or leave it blank if the information is not directly present. Format your complete response as a JSON object where keys are the exact questions and values are the extracted answers. Ensure the JSON is valid and contains no extra text.

    Source Text:
    ---
    ${sourceText}
    ---

    Questions to Answer:
    ${questions.map(q => `- ${q}`).join('\n')}

    Example JSON structure:
    {
      "Question 1": "Answer to Q1",
      "Question 2": "Answer to Q2",
      "Question 3": ""
    }
    `;

    console.log("Sending prompt to OpenRouter for form population...");
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_TO_USE,
        messages: [
          {
            role: 'system',
            content: `You are an expert data extractor. Your task is to precisely answer given questions based ONLY on the provided source text. Respond strictly in the specified JSON format. If information for a question is not found, use an empty string as the value.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1, // Keep temperature low for factual extraction
        max_tokens: 1000, // Allow enough tokens for multiple answers
        response_format: { type: "json_object" } // Request JSON output if model supports it (GPT-3.5-turbo often benefits from this)
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenRouter API responded with an error (form population):', errorData);
      return res.status(response.status).json({
        error: `OpenRouter API error during form population: ${response.statusText}`,
        details: errorData.message || 'Unknown error from OpenRouter',
      });
    }

    const data = await response.json();
    let populatedFields = {};

    if (data && data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
      const rawContent = data.choices[0].message.content;
      try {
        // Models might still wrap JSON in markdown, remove it
        const jsonString = rawContent.replace(/^```json\s*|```\s*$/g, '').trim();
        populatedFields = JSON.parse(jsonString);

        // Ensure all original questions are present in the final output, setting empty if AI missed one
        const finalPopulatedFields = {};
        questions.forEach(q => {
          finalPopulatedFields[q] = populatedFields[q] !== undefined ? populatedFields[q] : ''; // Use AI's answer, or empty if not present
        });
        populatedFields = finalPopulatedFields;

      } catch (jsonParseError) {
        console.error("Backend failed to parse OpenRouter form population response as JSON:", jsonParseError);
        return res.status(500).json({ error: "AI response parsing failed. Raw AI output (truncated): " + rawContent.substring(0, Math.min(rawContent.length, 200)) + '...' });
      }
    } else {
      return res.status(500).json({ error: 'AI did not provide content for form population.' });
    }

    res.json({ populated_fields: populatedFields });

  } catch (error) {
    console.error("Error in backend /api/populate_form:", error);
    res.status(500).json({
      error: 'Failed to populate form from OpenRouter.',
      details: error.message,
    });
  }
});


// --- NEW: Chat API Endpoint ---
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body; // Expects an array of messages [{ role: 'user', content: '...' }, ...]

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required for chat.' });
  }

  const OPENROUTER_API_KEY = checkApiKey(res);
  if (!OPENROUTER_API_KEY) return; // Exit if API key is missing

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_TO_USE, // Using the common model defined at the top
        messages: [
          { role: "system", content: "You are a helpful and knowledgeable AI research assistant. Provide concise, accurate, and relevant information. If asked about something beyond your knowledge, admit it gracefully. Keep responses helpful and on topic." },
          ...messages // Pass the conversation history
        ],
        temperature: 0.7, // Balanced creativity for chat
        max_tokens: 500, // Reasonable limit for chat responses
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenRouter API responded with an error (chat):', errorData);
      return res.status(response.status).json({
        error: `OpenRouter API error during chat: ${response.statusText}`,
        details: errorData.message || 'Unknown error from OpenRouter',
      });
    }

    const data = await response.json();
    if (data && data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
      const aiMessageContent = data.choices[0].message.content;
      res.json({ reply: aiMessageContent }); // Send the AI's response back
    } else {
      res.status(500).json({ error: 'AI did not provide content for chat response.' });
    }

  } catch (error) {
    console.error('Error in backend /api/chat:', error);
    res.status(500).json({
      error: 'Failed to get chat response from OpenRouter.',
      details: error.message,
    });
  }
});


// Basic root route for testing if the server is running
app.get('/', (req, res) => {
  res.send('Research Assistant Backend is running!');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Research Assistant Backend server listening on port ${PORT}`);
  // Check if API key is loaded on startup (useful for debugging)
  if (process.env.OPENROUTER_API_KEY) {
    console.log("OpenRouter API Key is loaded.");
  } else {
    console.error("OpenRouter API Key IS NOT loaded. Please check your .env file.");
  }
});