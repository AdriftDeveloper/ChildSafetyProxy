import express from 'express';
import { authRouter } from './auth';

export const router = express.Router();

router.use(authRouter);