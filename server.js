require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/auth', require('./routes/auth'));
app.use('/questions', require('./routes/questions'));
app.use('/answers', require('./routes/answers'));
app.use('/courses', require('./routes/courses'));
app.use('/tasks', require('./routes/tasks'));
app.use('/users', require('./routes/users'));

const { callGroqWithFailover } = require('./utils/groq');
const { buildSystemPrompt } = require('./utils/sagePrompt');

app.post('/ask', async (req, res) => {
    const { question, courseContext, history } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'Missing question' });
    }

    const systemPrompt = buildSystemPrompt(courseContext);

    // `history` is the whole conversation so far (client-managed), so Sage actually
    // remembers earlier messages instead of treating every request as brand new.
    const priorMessages = Array.isArray(history) ? history : [];

    try {
        const groqResponse = await callGroqWithFailover({
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
            messages: [
                { role: 'system', content: systemPrompt },
                ...priorMessages,
                { role: 'user', content: question }
            ]
        });

        const data = await groqResponse.json();

        if (!groqResponse.ok) {
            console.error('Groq API Error:', data);
            return res.status(502).json({ error: 'Sage is busy right now.' });
        }

        const answer = data.choices[0].message.content;
        res.json({ answer });

    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sage backend running on port ${PORT}`);
});
