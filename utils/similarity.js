// Mirrors SimilarityEngine.java exactly -- Jaccard similarity on lowercased, word-split text.
function calculateJaccardSimilarity(text1, text2) {
    if (!text1 || !text2) return 0.0;

    const set1 = new Set(text1.toLowerCase().split(/\W+/).filter(Boolean));
    const set2 = new Set(text2.toLowerCase().split(/\W+/).filter(Boolean));

    const intersection = new Set([...set1].filter(w => set2.has(w)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0.0;
    return intersection.size / union.size;
}

module.exports = { calculateJaccardSimilarity };
