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
      <div className="pointer-events-none absolute -left-24 -top-24 size-[500px] rounded-full bg-primary opacity-[0.04] blur-[40px]" />
      <div className="pointer-events-none absolute right-0 top-40 size-[600px] rounded-full bg-donor opacity-5 blur-[50px]" />
      <div className="pointer-events-none absolute left-1/2 top-96 size-[400px] rounded-full bg-admin opacity-[0.04] blur-[35px]" />

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
