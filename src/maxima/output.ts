export interface CleanedOutput {
  text: string;
  isError: boolean;
  warnings: string[];
  errorMessage?: string;
  truncated: boolean;
}

const ERROR_PATTERNS: RegExp[] = [
  /--\s*an error\.\s*To debug this try:\s*debugmode\(true\)/i,
  /Maxima encountered a Lisp error/i,
  /incorrect syntax:/i,
  /syntax error/i,
  /expt:\s*undefined/i,
  /Cannot find documentation for/i,
  /No such file or directory/i,
  /^error:/im,
  /^debugmode\(true\)/im,
  /Argument must be/i,
  /Function .* not found/i,
  /Package .* not found/i,
  /is not a (?:function|variable|list|matrix)/i,
  /division by zero/i,
  /Zero divisor/i,
  /Illegal (?:argument|value)/i,
  /unknown option/i,
];

const WARNING_PATTERN = /(?:^|\s)(?:warning|Warning|WARNING)\s*:/;
const NOISE_PATTERNS: RegExp[] = [
  /^\s*\*{5}\s+Spawning process\b.*$/gm,
  /^\s*\(%[io]\d+\)\s*$/gm,
  /^\s*\(%i\d+\)\s+/gm,
];

/** Remove internal markers and Maxima terminal noise from raw output. */
export function cleanOutput(raw: string, maxChars = 200_000): CleanedOutput {
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const pattern of NOISE_PATTERNS) {
    text = text.replace(pattern, "");
  }
  // Markers are printed with a trailing space by Maxima's print().
  text = text.replace(/<<<MAXIMA_MCP_(?:BEGIN|END):[^>]+>>>/g, "");
  // Some Maxima functions emit bare (%iN) prompts when evaluated non-interactively.
  text = text.replace(/\(%[io]\d+\)\s*/g, "");
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const warnings: string[] = [];
  let errorMessage: string | undefined;
  for (const line of text.split("\n")) {
    if (WARNING_PATTERN.test(line)) warnings.push(line.trim());
    if (!errorMessage && ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
      errorMessage = line.trim();
    }
  }

  let truncated = false;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n... [output truncated: ${text.length - maxChars} characters omitted]`;
    truncated = true;
  }

  return {
    text,
    isError: errorMessage !== undefined,
    warnings,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    truncated,
  };
}

/** True when text contains a recognisable Maxima/Lisp error message. */
export function isErrorText(text: string): boolean {
  return ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/** Combine stdout and stderr for display without duplicating content. */
export function mergeStreams(stdout: string, stderr: string): string {
  const err = stderr.trim();
  if (!err) return stdout;
  if (!stdout.trim()) return err;
  return `${stdout.trimEnd()}\n${err}`;
}
