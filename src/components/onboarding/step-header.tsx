import * as React from "react";

/** "Langkah 2 dari 3" with a heading. The heading takes focus when the step changes. */
export const StepHeader = React.forwardRef<
  HTMLHeadingElement,
  { step: number; total: number; title: string; description?: string }
>(function StepHeader({ step, total, title, description }, ref) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-helper font-semibold text-text-muted">
        Langkah {step} dari {total}
      </p>
      <h1 ref={ref} tabIndex={-1} className="text-page-title font-bold outline-none">
        {title}
      </h1>
      {description ? <p className="max-w-prose text-text-muted">{description}</p> : null}
    </div>
  );
});
