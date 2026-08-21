"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface MarkdownProps {
  /** The document heading level represented by a Markdown `#` heading. */
  baseHeadingLevel?: MarkdownHeadingLevel;
  className?: string;
  children: string;
}

const paragraphClassName = "my-1.5 leading-6 first:mt-0 last:mb-0";
const headingClassName = "mb-2 mt-3 font-semibold first:mt-0 last:mb-0";
const headingSizeClassNames: Record<MarkdownHeadingLevel, string> = {
  1: "text-lg",
  2: "text-base",
  3: "text-sm",
  4: "text-sm",
  5: "text-sm",
  6: "text-sm",
};

/**
 * Renders embedded Markdown without introducing a second page-level heading.
 * Heading ranks are offset from the surrounding document hierarchy.
 */
export function Markdown({
  baseHeadingLevel = 2,
  className,
  children,
}: MarkdownProps) {
  const renderHeading = (markdownLevel: MarkdownHeadingLevel) => {
    const headingLevel = Math.min(
      6,
      baseHeadingLevel + markdownLevel - 1,
    ) as MarkdownHeadingLevel;
    const Heading = `h${headingLevel}` as const;

    return ({
      node: _node,
      ...props
    }: { node?: unknown } & React.ComponentPropsWithoutRef<"h1">) => (
      <Heading
        className={cn(headingClassName, headingSizeClassNames[markdownLevel])}
        {...props}
      />
    );
  };

  return (
    <div className={cn("text-sm leading-6", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node: _node, ...props }) => (
            <p className={paragraphClassName} {...props} />
          ),
          h1: renderHeading(1),
          h2: renderHeading(2),
          h3: renderHeading(3),
          h4: renderHeading(4),
          h5: renderHeading(5),
          h6: renderHeading(6),
          ul: ({ node: _node, ...props }) => (
            <ul
              className="my-1.5 list-disc space-y-1 pl-5 first:mt-0 last:mb-0"
              {...props}
            />
          ),
          ol: ({ node: _node, ...props }) => (
            <ol
              className="my-1.5 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0"
              {...props}
            />
          ),
          li: ({ node: _node, ...props }) => (
            <li className="leading-6" {...props} />
          ),
          a: ({ node: _node, ...props }) => (
            <a
              className="font-medium text-primary underline underline-offset-2"
              {...props}
              rel="noopener noreferrer"
            />
          ),
          blockquote: ({ node: _node, ...props }) => (
            <blockquote
              className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground first:mt-0 last:mb-0"
              {...props}
            />
          ),
          hr: ({ node: _node, ...props }) => (
            <hr className="my-3 border-border" {...props} />
          ),
          pre: ({ node: _node, ...props }) => (
            <pre
              className="my-2 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-sm first:mt-0 last:mb-0"
              {...props}
            />
          ),
          code: ({ node: _node, className, children, ...props }) => {
            const text = Array.isArray(children)
              ? children.join("")
              : String(children ?? "");
            const isBlock = Boolean(className) || text.includes("\n");
            if (isBlock) {
              return (
                <code
                  className={cn("block font-mono text-sm", className)}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ node: _node, ...props }) => (
            <table
              className="my-2 w-full border-collapse text-left first:mt-0 last:mb-0"
              {...props}
            />
          ),
          th: ({ node: _node, ...props }) => (
            <th
              className="border border-border bg-muted px-2 py-1 font-medium"
              {...props}
            />
          ),
          td: ({ node: _node, ...props }) => (
            <td className="border border-border px-2 py-1" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
