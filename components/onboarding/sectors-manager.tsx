"use client"
import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import type { SetupSector } from "@/features/onboarding/setup-readiness"
import { activeCompetencyNames, createEmptySector } from "@/features/sectors"
/* eslint-disable react-hooks/set-state-in-effect */
/** Reusable sector editor shared by configuration screens. */
export function SectorsManager() { const [sectors, setSectors] = useState<readonly SetupSector[]>([]); const [name, setName] = useState(""); const [skills, setSkills] = useState(""); useEffect(() => setSectors(createSetupRepository(window.localStorage).listSectors()), []); function add() { const value = name.trim(); if (!value) return; const base = createEmptySector(); const competencies = skills.split(",").map((skill) => skill.trim()).filter(Boolean).map((skill, order) => ({ id: `competency_${crypto.randomUUID()}`, name: skill, archived: false, order })); const next = [...sectors, { ...base, name: value, competencies }]; createSetupRepository(window.localStorage).saveSectors(next); setSectors(next); setName(""); setSkills("") } return <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom du secteur" aria-label="Nom du secteur" /><Input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Compétences, séparées par des virgules" aria-label="Compétences" /></div><Button type="button" onClick={add}><Plus />Créer un secteur</Button>{sectors.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun secteur créé. Ajoutez la première zone à couvrir.</p> : <ul className="divide-y rounded-lg border">{sectors.map((sector) => <li className="p-3 text-sm" key={sector.id}><p className="font-medium">{sector.name}</p><p className="text-muted-foreground">{activeCompetencyNames(sector).join(", ") || "Compétences facultatives"}</p></li>)}</ul>}</div> }
