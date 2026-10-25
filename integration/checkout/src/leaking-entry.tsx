import {createRoot} from 'react-dom/client'
import {Checkout} from './App'
import {checkout} from './leaking'
import {installSyntheticProvider} from './provider-fixture'
const synthetic = installSyntheticProvider()
createRoot(document.getElementById('root')!).render(synthetic ? <Checkout run={checkout}/> : <p>This integration fixture requires synthetic test data. Run npm run test:package from the ZTrace checkout.</p>)
