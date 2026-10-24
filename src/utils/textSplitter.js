/**
 * 长文本/代码智能自然断行分卷算法
 * 专用于突破跳板机/VDI/堡垒机单次剪贴板字符限制（如 4096 字符）
 */

export const DEFAULT_CHUNK_THRESHOLD = 3500;

/**
 * 将长文本智能切分为自然语义分卷
 * @param {string} text - 待切分长文本
 * @param {number} maxChunkSize - 单卷最大字符数（默认 3500）
 * @returns {Array<{index: number, total: number, content: string, charCount: number, startLine: number, endLine: number, preview: string}>}
 */
export function splitTextIntoChunks(text, maxChunkSize = DEFAULT_CHUNK_THRESHOLD) {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }

  const limit = Math.max(200, Number(maxChunkSize) || DEFAULT_CHUNK_THRESHOLD);
  if (text.length <= limit) {
    const totalLines = (text.match(/\n/g) || []).length + 1;
    return [{
      index: 1,
      total: 1,
      content: text,
      charCount: text.length,
      startLine: 1,
      endLine: totalLines,
      preview: text.slice(0, 80).replace(/[\r\n]+/g, ' ').trim(),
    }];
  }

  const chunks = [];
  let currentStart = 0;
  let currentLineNumber = 1;

  while (currentStart < text.length) {
    const remainingLength = text.length - currentStart;
    if (remainingLength <= limit) {
      const slice = text.slice(currentStart);
      const linesInSlice = (slice.match(/\n/g) || []).length;
      chunks.push({
        index: chunks.length + 1,
        content: slice,
        charCount: slice.length,
        startLine: currentLineNumber,
        endLine: currentLineNumber + linesInSlice,
        preview: slice.slice(0, 80).replace(/[\r\n]+/g, ' ').trim(),
      });
      break;
    }

    // 寻找最佳断点（从 currentStart + limit 往前搜索）
    const idealEnd = currentStart + limit;
    let breakPoint = -1;

    // 1. 优先寻找自然换行符 \n（回溯最多 800 字符）
    const searchBackWindow = Math.min(800, limit - 100);
    const lineSearchStart = Math.max(currentStart, idealEnd - searchBackWindow);
    const lastNewline = text.lastIndexOf('\n', idealEnd);
    if (lastNewline >= lineSearchStart) {
      // 在换行符之后断开，包含换行符本身
      breakPoint = lastNewline + 1;
    }

    // 2. 次级寻找句子标点或代码分号/逗号（回溯最多 400 字符）
    if (breakPoint === -1) {
      const punctSearchStart = Math.max(currentStart, idealEnd - 400);
      for (let i = idealEnd; i >= punctSearchStart; i--) {
        const char = text[i];
        if (char === ';' || char === '；' || char === '。' || char === '.' || char === ',' || char === '，' || char === ' ') {
          breakPoint = i + 1;
          break;
        }
      }
    }

    // 3. 兜底：如果完全没有标点，硬切在 idealEnd
    if (breakPoint === -1 || breakPoint <= currentStart) {
      breakPoint = idealEnd;
    }

    const chunkContent = text.slice(currentStart, breakPoint);
    const linesInChunk = (chunkContent.match(/\n/g) || []).length;
    chunks.push({
      index: chunks.length + 1,
      content: chunkContent,
      charCount: chunkContent.length,
      startLine: currentLineNumber,
      endLine: currentLineNumber + linesInChunk,
      preview: chunkContent.slice(0, 80).replace(/[\r\n]+/g, ' ').trim(),
    });

    currentStart = breakPoint;
    currentLineNumber += linesInChunk;
  }

  // 补齐 total 字段
  const total = chunks.length;
  for (const chunk of chunks) {
    chunk.total = total;
  }

  return chunks;
}
