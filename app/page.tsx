import { redirect } from "next/navigation"

import { hasStore, isFirstRunComplete } from "@/features/store/services/store.repository"

export default async function Home() {
  redirect((await hasStore()) && (await isFirstRunComplete()) ? "/dashboard" : "/onboarding")
}
