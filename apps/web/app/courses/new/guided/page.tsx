"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react";
import Link from "next/link";

import { CourseCreationClient } from "@/components/course-creation-client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export default function GuidedCoursePage() {
  const { t } = useI18n();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/courses/new">
            <ArrowLeftIcon aria-hidden data-icon="inline-start" />
            {t("courses.create.title")}
          </Link>
        </Button>
      </div>
      <PageHeader
        title={t("authoring.connected.title")}
        description={t("authoring.connected.pageDescription")}
      />
      <CourseCreationClient mode="guided" />
    </div>
  );
}
