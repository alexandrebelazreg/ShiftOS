import { PageHeader } from "@/components/layout/page-header"
import { StoreConfigurationView } from "@/features/store/components/StoreConfigurationView"
import { getStore } from "@/features/store/services/store.repository"
export default async function ConfigurationStorePage() { const store = await getStore(); return store ? <StoreConfigurationView store={store} /> : <PageHeader title="Configuration du magasin" description="Commencez par configurer votre magasin." /> }
