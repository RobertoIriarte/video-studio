import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './app';
import { PrivateApp } from './private-app';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró la raíz de la aplicación.');

const router = createBrowserRouter([{ path: '*', element: import.meta.env.MODE === 'demo' ? <App /> : <PrivateApp /> }]);
createRoot(root).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
