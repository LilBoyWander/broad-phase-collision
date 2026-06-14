import './style.css';
import { CollisionPipelineApp } from './app';

const appRoot = document.querySelector<HTMLDivElement>('#app');

if (!appRoot) {
  throw new Error('App root not found.');
}

const app = new CollisionPipelineApp(appRoot);
app.mount();
