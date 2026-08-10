import { redirect } from "next/navigation";

export default function MistakesPage() {
  redirect("/review?view=mistakes");
}
