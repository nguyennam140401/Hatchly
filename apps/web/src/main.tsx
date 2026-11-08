import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StartPage } from './app/StartPage';

const root = document.getElementById('root');
if (!root) throw new Error('Không tìm thấy phần tử #root');

createRoot(root).render(
  <StrictMode>
    <StartPage />
  </StrictMode>,
);
