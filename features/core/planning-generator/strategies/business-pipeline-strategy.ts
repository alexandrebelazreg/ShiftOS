import type { GenerationStrategy } from "@/features/core/planning-generator/types"
import { runBusinessPipeline } from "@/features/core/planning-generator/pipeline"
export const businessPipelineStrategy: GenerationStrategy = { name: "business-pipeline-v2", generate: runBusinessPipeline }
