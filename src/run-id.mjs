export function validateRunId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)
    || value.endsWith('.') || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error('Run ID must be a safe 1–128 character directory name using letters, digits, dots, underscores, or hyphens');
  }
  return value;
}
