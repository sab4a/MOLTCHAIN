import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './components/Dashboard'
import Validators from './components/Validators'
import Transactions from './components/Transactions'
import Wallet from './components/Wallet'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="validators" element={<Validators />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="wallet" element={<Wallet />} />
      </Route>
    </Routes>
  )
}

export default App
