import { Routes, Route, Link } from 'react-router-dom'
import Ashray0 from './pages/Ashray0.jsx'
import Ashray1 from './pages/Ashray1.jsx'
import Ashray2 from './pages/Ashray2.jsx'
import Login from './pages/auth/Login.jsx'
import Register from './pages/auth/Register.jsx'
import PatientSignup from './pages/auth/PatientSignup.jsx'
import DonorSignup from './pages/auth/DonorSignup.jsx'
import EligibilityEngine from './pages/donor/EligibilityEngine.jsx'
import UpdateRecords from './pages/donor/UpdateRecords.jsx'
import WeightValidation from './pages/donor/WeightValidation.jsx'
import RideBounties from './pages/donor/RideBounties.jsx'
import DoctorSlipOcr from './pages/patient/DoctorSlipOcr.jsx'
import CbcTriage from './pages/patient/CbcTriage.jsx'
import LiveTracker from './pages/patient/LiveTracker.jsx'
import EnRoute from './pages/donor/EnRoute.jsx'
import GeoRipple from './pages/admin/GeoRipple.jsx'
import PingLog from './pages/admin/PingLog.jsx'
import RareBlood from './pages/admin/RareBlood.jsx'
import Escalation from './pages/admin/Escalation.jsx'
import AdminLogin from './pages/admin/AdminLogin.jsx'
import AdminConsole from './pages/admin/AdminConsole.jsx'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Ashray0 />} />

      {/* Auth */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/register/patient" element={<PatientSignup />} />
      <Route path="/register/donor" element={<DonorSignup />} />

      {/* Patient / Family */}
      <Route path="/patient/ocr" element={<DoctorSlipOcr />} />
      <Route path="/patient/cbc-triage" element={<CbcTriage />} />
      {/* Both accept the request id in the path or as ?request=… — a family
          following a push notification has one, a family arriving cold does not. */}
      <Route path="/patient/track" element={<LiveTracker />} />
      <Route path="/patient/track/:requestId" element={<LiveTracker />} />

      {/* Donor */}
      <Route path="/donor/sleep" element={<Ashray1 />} />
      <Route path="/donor/eligibility" element={<EligibilityEngine />} />
      <Route path="/donor/records" element={<UpdateRecords />} />
      <Route path="/donor/weight" element={<WeightValidation />} />
      <Route path="/donor/en-route" element={<EnRoute />} />
      <Route path="/donor/en-route/:requestId" element={<EnRoute />} />
      <Route path="/donor/bounties" element={<RideBounties />} />

      {/* Admin console (real backend + JWT) */}
      <Route path="/admin" element={<AdminConsole />} />
      <Route path="/admin/login" element={<AdminLogin />} />

      {/* Admin (mock demo pages) */}
      <Route path="/admin/dispatch" element={<GeoRipple />} />
      <Route path="/admin/concurrency" element={<Ashray2 />} />
      <Route path="/admin/pings" element={<PingLog />} />
      <Route path="/admin/rare-blood" element={<RareBlood />} />
      <Route path="/admin/escalation" element={<Escalation />} />

      {/* Legacy aliases */}
      <Route path="/ashray1" element={<Ashray1 />} />
      <Route path="/ashray2" element={<Ashray2 />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink text-white">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="text-primary underline">
        Go home
      </Link>
    </div>
  )
}

export default App
