import TopBar from './TopBar.jsx'

/** Page shell: dark background with ambient glows, sticky TopBar, centered main. */
export default function Shell({
  panel,
  panelColor = 'primary',
  right,
  children,
  max = 'max-w-[1256px]',
  center = false,
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ink text-white">
      {/* Subtle grid pattern */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px]" />
      
      {/* Animated ambient blobs */}
      <div className="pointer-events-none absolute -left-24 -top-24 size-[600px] animate-blob rounded-full bg-primary/20 blur-[100px]" />
      <div className="pointer-events-none absolute right-0 top-40 size-[700px] animate-blob rounded-full bg-donor/15 blur-[120px] [animation-delay:2s]" />
      <div className="pointer-events-none absolute left-1/2 top-96 size-[500px] animate-blob rounded-full bg-admin/20 blur-[100px] [animation-delay:4s]" />

      <div className="relative z-10">
        <TopBar panel={panel} panelColor={panelColor} right={right} />
        <main
          className={`mx-auto ${max} px-4 py-8 sm:px-6 ${
            center ? 'flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center' : ''
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
