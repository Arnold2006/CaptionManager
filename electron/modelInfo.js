// Shared VLM model identity (CommonJS, Electron main + scripts reference).
//
// Official Qwen3-VL-8B-Instruct GGUFs. This replaces an abliterated community
// fine-tune: abliteration degrades instruction and JSON-schema adherence, which
// shows up as sloppy bounding boxes and echoed values in captions. Same size,
// same quant level, same download flow — just the unmodified model and Qwen's
// own vision projector. Sizes are the exact byte counts HuggingFace serves.
const MODEL_FILE = 'Qwen3VL-8B-Instruct-Q4_K_M.gguf';
const MODEL_SIZE = 5027784800;
const MMPROJ_FILE = 'mmproj-Qwen3VL-8B-Instruct-F16.gguf';
const MMPROJ_SIZE = 1159029824;
const REPO = 'Qwen/Qwen3-VL-8B-Instruct-GGUF';

module.exports = { MODEL_FILE, MODEL_SIZE, MMPROJ_FILE, MMPROJ_SIZE, REPO };
