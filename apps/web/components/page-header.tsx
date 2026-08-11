import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between lg:gap-10",
        className,
      )}
    >
      <div className="flex min-w-0 max-w-[52rem] flex-col gap-3">
        <h1 className="min-w-0 text-balance text-[2.25rem]/[2.6rem] font-[650] tracking-[-0.035em] [overflow-wrap:anywhere] sm:text-[2.75rem]/[3.05rem]">
          {title}
        </h1>
        <p className="min-w-0 max-w-[68ch] text-pretty text-[1.0625rem] leading-7 text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-4 sm:w-auto sm:shrink-0 sm:pt-6 [&_[data-slot=button]]:min-h-12 [&_[data-slot=button]]:px-6 [&_[data-slot=button]]:text-base">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
