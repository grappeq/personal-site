import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { it } from 'vitest';
import App from './App.jsx';

it('renders without crashing', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
        root.render(<App />);
    });
    act(() => {
        root.unmount();
    });
});
