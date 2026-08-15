const express = require('express');
const pool = require('../db');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();

// Mirrors CourseDAO.getCoursesForProgramAndSemester() -- powers the sidebar.
router.get('/', async (req, res) => {
    const { program, semester } = req.query;
    if (!program || !semester) {
        return res.status(400).json({ error: 'program and semester are required.' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT c.id, c.name, c.code, cp.semester FROM courses c
             JOIN course_programs cp ON c.id = cp.course_id
             WHERE cp.program_code = ? AND cp.semester = ? ORDER BY c.name ASC`,
            [program, semester]
        );
        res.json(rows);
    } catch (err) {
        console.error('Get courses error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors CourseDAO.getAllCoursesForProgram() -- powers "Other Semesters" browsing.
router.get('/all-for-program', async (req, res) => {
    const { program } = req.query;
    if (!program) return res.status(400).json({ error: 'program is required.' });

    try {
        const [rows] = await pool.query(
            `SELECT c.id, c.name, c.code, cp.semester FROM courses c
             JOIN course_programs cp ON c.id = cp.course_id
             WHERE cp.program_code = ? ORDER BY cp.semester ASC, c.name ASC`,
            [program]
        );
        res.json(rows);
    } catch (err) {
        console.error('Get all courses for program error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// --- Admin only below ---

// Mirrors CourseDAO.getAllCourses() + getProgramSummaryForAllCourses() combined into one response.
router.get('/admin/all', requireAdmin, async (req, res) => {
    try {
        const [courses] = await pool.query('SELECT id, name, code FROM courses ORDER BY name ASC');
        const [links] = await pool.query(
            `SELECT course_id, GROUP_CONCAT(CONCAT(program_code, ':', semester) ORDER BY program_code SEPARATOR ', ') AS links
             FROM course_programs GROUP BY course_id`
        );
        const linkMap = {};
        for (const row of links) linkMap[row.course_id] = row.links;

        res.json(courses.map(c => ({ ...c, programLinks: linkMap[c.id] || 'not linked to any program' })));
    } catch (err) {
        console.error('Admin get courses error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors CourseDAO.updateCourseName() + updateCourseCode()
router.put('/admin/:id', requireAdmin, async (req, res) => {
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'name and code are required.' });

    try {
        await pool.query('UPDATE courses SET name = ?, code = ? WHERE id = ?', [name, code, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Update course error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

// Mirrors CourseDAO.addCourse() -- reuses an existing course by code instead of duplicating.
router.post('/admin', requireAdmin, async (req, res) => {
    const { name, code, program, semester } = req.body;
    if (!name || !code || !program || !semester) {
        return res.status(400).json({ error: 'name, code, program, and semester are required.' });
    }

    try {
        const [[existing]] = await pool.query('SELECT id FROM courses WHERE code = ?', [code]);
        let courseId;

        if (existing) {
            courseId = existing.id;
        } else {
            const [result] = await pool.query('INSERT INTO courses (name, code) VALUES (?, ?)', [name, code]);
            courseId = result.insertId;
        }

        await pool.query(
            'INSERT INTO course_programs (course_id, program_code, semester) VALUES (?, ?, ?)',
            [courseId, program, semester]
        );
        res.json({ success: true, courseId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'This course is already linked to that program+semester.' });
        }
        console.error('Add course error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});

module.exports = router;
