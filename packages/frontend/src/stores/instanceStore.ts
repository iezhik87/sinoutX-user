import { create } from 'zustand'
import { configApi } from '@/api/client'
import { initCloudPwa } from '@/lib/pwa'

// What KIND of instance this is, read once at boot from the public /config.
// `cloud` gates our-cloud-only features (the mobile app shell and PWA install);
// self-hosted instances get the regular desktop web. Null until loaded — treat
// as "not cloud" so nothing cloud-only flashes before the flag arrives.
interface InstanceState {
  cloud: boolean | null
  solo: boolean | null
  loaded: boolean
  load: () => Promise<void>
}

export const useInstanceStore = create<InstanceState>((set, get) => ({
  cloud: null,
  solo: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return
    try {
      const cfg = await configApi.get()
      set({ cloud: !!cfg.cloud, solo: !!cfg.solo, loaded: true })
      // Enable installability (manifest + apple meta) only on our cloud.
      if (cfg.cloud) initCloudPwa()
    } catch {
      // Backend unreachable / old build without /config → behave as self-hosted.
      set({ cloud: false, solo: false, loaded: true })
    }
  },
}))

/** True only on our cloud instance (billing on). Safe default false. */
export const useIsCloud = () => useInstanceStore((s) => s.cloud === true)

/** True on the solo self-hosted edition (no admin, no billing, single user). */
export const useIsSolo = () => useInstanceStore((s) => s.solo === true)
