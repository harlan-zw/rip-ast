import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      // Bundle the development-only Vue service with its locked, trusted Pug dependency.
      input: ['./src/index.ts'],
    },
  ],
})
