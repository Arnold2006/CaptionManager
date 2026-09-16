// llama.cpp grammar schemas for constrained caption generation (CommonJS).
// GENERATION_SCHEMA is a deliberately strict subset of the official Ideogram 4
// schema: every property is always emitted in definition order because the
// grammar emits listed properties in order. normalize/validate enforce the
// rest (hex charset, bbox 0-1000 range, photo/art variant, key order).

// "#RRGGBB" is exactly 7 chars; charset enforced post-generation.
const HEX_COLOR = { type: 'string', minLength: 7, maxLength: 7 };

// Labeled bbox object so the model writes each coordinate next to its axis
// name; the normalizer converts to the official array form
// [y_min, x_min, y_max, x_max] and clamps to 0-1000.
const BBOX = {
  type: 'object',
  required: ['y_min', 'x_min', 'y_max', 'x_max'],
  properties: {
    y_min: { type: 'integer' },
    x_min: { type: 'integer' },
    y_max: { type: 'integer' },
    x_max: { type: 'integer' }
  }
};

const GENERATION_SCHEMA = {
  type: 'object',
  required: ['high_level_description', 'style_description', 'compositional_deconstruction'],
  properties: {
    high_level_description: { type: 'string', minLength: 1 },
    style_description: {
      type: 'object',
      required: ['aesthetics', 'lighting', 'medium', 'photo', 'art_style', 'color_palette'],
      properties: {
        aesthetics: { type: 'string', minLength: 1 },
        lighting: { type: 'string', minLength: 1 },
        medium: { type: 'string', minLength: 1 },
        photo: { type: 'string', minLength: 1 },
        art_style: { type: 'string', minLength: 1 },
        color_palette: { type: 'array', items: HEX_COLOR, minItems: 1, maxItems: 16 }
      }
    },
    compositional_deconstruction: {
      type: 'object',
      required: ['background', 'elements'],
      properties: {
        background: { type: 'string', minLength: 1 },
        elements: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            oneOf: [
              {
                type: 'object',
                required: ['type', 'bbox', 'desc', 'color_palette'],
                properties: {
                  type: { const: 'obj' },
                  bbox: BBOX,
                  desc: { type: 'string', minLength: 1 },
                  color_palette: { type: 'array', items: HEX_COLOR, minItems: 1, maxItems: 5 }
                }
              },
              {
                type: 'object',
                required: ['type', 'bbox', 'text', 'desc', 'color_palette'],
                properties: {
                  type: { const: 'text' },
                  bbox: BBOX,
                  text: { type: 'string', minLength: 1 },
                  desc: { type: 'string', minLength: 1 },
                  color_palette: { type: 'array', items: HEX_COLOR, minItems: 1, maxItems: 5 }
                }
              }
            ]
          }
        }
      }
    }
  }
};

const TEXT_VERIFY_SCHEMA = {
  type: 'object',
  required: ['texts'],
  properties: { texts: { type: 'array', items: { type: 'string' } } }
};

module.exports = { GENERATION_SCHEMA, TEXT_VERIFY_SCHEMA };
