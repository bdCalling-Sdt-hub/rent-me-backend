import express from 'express';



export  const largeBodyParser = [
  express.json({ limit: '15mb' }),
  express.urlencoded({ limit: '15mb', extended: true })
];


