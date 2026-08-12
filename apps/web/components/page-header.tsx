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
        "flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between lg:gap-8",
        className,
      )}
    >
      <div className="flex min-w-0 max-w-[58rem] flex-col gap-2">
        <h1 className="min-w-0 text-balance text-[2rem]/[2.3rem] font-[650] tracking-[-0.03em] [overflow-wrap:anywhere] sm:text-[2.4rem]/[2.7rem]">
          {title}
        </h1>
        <p className="min-w-0 max-w-[72ch] text-pretty text-base leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:shrink-0 sm:pt-3 [&_[data-slot=button]]:min-h-11 [&_[data-slot=button]]:px-5">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
