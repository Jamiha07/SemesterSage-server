// A pool of independent Groq accounts' keys, so their rate limits don't share one bucket.
const GROQ_API_KEYS = process.env.GROQ_API_KEYS.split(',').map(k => k.trim());
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

let nextKeyIndex = 0;

// Picks the next key in rotation, wrapping back to the start once it reaches the end.
function pickNextKey() {
    const key = GROQ_API_KEYS[nextKeyIndex];
    nextKeyIndex = (nextKeyIndex + 1) % GROQ_API_KEYS.length;
    return key;
}

// Tries each key in the pool, starting from the next one in rotation, until one succeeds
// or every key has been tried. Only moves on to the next key when the current one is
// specifically rate-limited (429) -- any other error/success stops immediately.
async function callGroqWithFailover(payload) {
    let lastResponse = null;

    for (let attempt = 0; attempt < GROQ_API_KEYS.length; attempt++) {
        const key = pickNextKey();

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.status !== 429) {
            return response;
        }

        console.warn(`Key ending in ...${key.slice(-4)} is rate-limited, trying the next one.`);
        lastResponse = response;
    }

    // Every key in the pool was rate-limited.
    return lastResponse;
}

module.exports = { callGroqWithFailover };
