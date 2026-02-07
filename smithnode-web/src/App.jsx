import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Validators from './components/Validators'
import Transactions from './components/Transactions'
import Wallet from './components/Wallet'
import Governance from './components/Governance'
import Discussions from './components/Discussions'
import Network from './components/Network'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="validators" element={<Validators />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="governance" element={<Governance />} />
        <Route path="discussions" element={<Discussions />} />
        <Route path="network" element={<Network />} />
      </Route>
    </Routes>
  )
}

export default App
