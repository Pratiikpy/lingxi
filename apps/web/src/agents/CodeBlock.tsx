import { Fragment } from "react";
import { codePieces } from "./codeBreaks";

/**
 * A code sample (R25): each of its lines is drawn as one, and a line too long for the screen wraps with its later rows
 * set in, so a wrapped row is never read as a line of its own. An address in it breaks only after a slash or before
 * "?" and "&" (codeBreaks.ts): each piece between those places is kept whole, and a <wbr> marks each place, so a copy
 * of the sample is exactly its text.
 */
export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="ag-code">
      {code.split("\n").map((line, i) => (
        <span key={i} className="ag-line">
          {codePieces(line).map((p, j) =>
            p.url ? (
              <Fragment key={j}>
                {p.parts.map((part, k) => (
                  <Fragment key={k}>
                    {k > 0 && <wbr />}
                    <span className="ag-url-part">{part}</span>
                  </Fragment>
                ))}
              </Fragment>
            ) : (
              p.text
            ),
          )}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
