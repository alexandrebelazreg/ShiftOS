import { redirect } from "next/navigation"
export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; redirect(`/configuration/employes/${id}`) }
