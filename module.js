// Module factory function that accepts APP_ID as parameter
module.exports = function createAppModule(APP_ID) {
 const express = require('express');
 const path = require('path');
 const fs = require('fs');
 const { PrismaClient } = require('@prisma/client');
 const { createServer } = require('http');
 const { Server } = require('socket.io');

  const app = express();
  const prisma = new PrismaClient();

 // ===== SMART ROUTING DETECTION =====
 // Detect if running standalone (server.js) or embedded (parent server)
 const IS_EMBEDDED = global.PARENT_SERVER_MODE || process.env.EMBEDDED_MODE;
 const API_BASE = IS_EMBEDDED ? `/api/${APP_ID}` : '';
  
 // ===== SOCKET.IO SETUP =====
 let appSocket = null;
  
 // Socket.IO setup function
 function attachSocketNamespace(namespace) {
   appSocket = namespace;
    
   // Clear any existing listeners to prevent duplicates when module reloads
   appSocket.removeAllListeners('connection');
    
   appSocket.on('connection', (socket) => {
     console.log(`🔌 Client connected to app ${APP_ID}: ${socket.id}`);
      
     // Clear any existing listeners on this socket (safety measure)
     socket.removeAllListeners('chat_message');
     socket.removeAllListeners('disconnect');
      
     // Handle chat messages
     socket.on('chat_message', (data) => {
       console.log('📥 Chat message received:', data);
       // Broadcast to all clients
       appSocket.emit('chat_message', data);
     });
      
     socket.on('disconnect', () => {
       console.log(`🔌 Client disconnected from app ${APP_ID}: ${socket.id}`);
     });
   });
 }
  
 // Export the attach function
 app.attachSocketNamespace = attachSocketNamespace;

  // ===== BASIC MIDDLEWARE =====
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static('.'));

  // ===== CORS SUPPORT =====
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // ===== APPOINTMENT BOOKING ROUTES =====
  
  // Create new appointment
  app.post(`${API_BASE}/appointments`, async (req, res) => {
    try {
      const {
        fullName,
        phone,
        email,
        preferredDate,
        preferredTime,
        serviceType,
        caseDescription,
        timestamp
      } = req.body;

      const appointment = await prisma.appointment.create({
        data: {
          fullName,
          phone,
          email: email || null,
          preferredDate: preferredDate || null,
          preferredTime: preferredTime || null,
          serviceType,
          caseDescription: caseDescription || null,
          status: 'pending',
          createdAt: new Date(timestamp)
        }
      });

      console.log('📅 New appointment created:', appointment.id);
      res.json({ success: true, appointment });
    } catch (error) {
      console.error('Error creating appointment:', error);
      res.status(500).json({ 
        success: false, 
        error: 'حدث خطأ في حفظ الموعد. يرجى المحاولة مرة أخرى.' 
      });
    }
  });

  // Get all appointments (for admin use)
  app.get(`${API_BASE}/appointments`, async (req, res) => {
    try {
      const appointments = await prisma.appointment.findMany({
        orderBy: {
          createdAt: 'desc'
        }
      });
      res.json(appointments);
    } catch (error) {
      console.error('Error fetching appointments:', error);
      res.status(500).json({ error: 'خطأ في جلب المواعيد' });
    }
  });

  // Update appointment status
  app.put(`${API_BASE}/appointments/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;

      const appointment = await prisma.appointment.update({
        where: { id },
        data: {
          status,
          notes: notes || null,
          updatedAt: new Date()
        }
      });

      res.json({ success: true, appointment });
    } catch (error) {
      console.error('Error updating appointment:', error);
      res.status(500).json({ error: 'خطأ في تحديث الموعد' });
    }
  });

  // Delete appointment
  app.delete(`${API_BASE}/appointments/:id`, async (req, res) => {
    try {
      const { id } = req.params;
      
      await prisma.appointment.delete({
        where: { id }
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting appointment:', error);
      res.status(500).json({ error: 'خطأ في حذف الموعد' });
    }
  });

  // Get appointment statistics
  app.get(`${API_BASE}/appointments/stats`, async (req, res) => {
    try {
      const totalAppointments = await prisma.appointment.count();
      const pendingAppointments = await prisma.appointment.count({
        where: { status: 'pending' }
      });
      const confirmedAppointments = await prisma.appointment.count({
        where: { status: 'confirmed' }
      });
      const completedAppointments = await prisma.appointment.count({
        where: { status: 'completed' }
      });

      // Get appointments by service type
      const serviceStats = await prisma.appointment.groupBy({
        by: ['serviceType'],
        _count: {
          serviceType: true
        }
      });

      res.json({
        total: totalAppointments,
        pending: pendingAppointments,
        confirmed: confirmedAppointments,
        completed: completedAppointments,
        byService: serviceStats
      });
    } catch (error) {
      console.error('Error fetching appointment stats:', error);
      res.status(500).json({ error: 'خطأ في جلب الإحصائيات' });
    }
  });

  // ===== DEFAULT ROUTES =====
  // Serve the main HTML file
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  // Health check endpoint
  app.get(`${API_BASE}/health`, (req, res) => {
    const health = {
      status: 'ok', 
      appId: APP_ID,
      mode: IS_EMBEDDED ? 'embedded' : 'standalone',
      timestamp: new Date().toISOString(),
      service: 'عيادة العلاج النطقي - د. وفاق وهبي',
      // Environment info (useful for debugging)
      env: {
        nodeVersion: process.version,
        platform: process.platform
      }
    };
    
    res.json(health);
  });

  // ===== ERROR HANDLING =====
  app.use((err, req, res, next) => {
    console.error('App error:', err);
    
    // Report error to parent server when running in embedded mode
    if (IS_EMBEDDED && typeof process.emitAppError === 'function') {
      try {
        let errorType = 'runtime_error';
        if (err.name === 'PrismaClientValidationError') {
          errorType = 'database_validation_error';
        } else if (err.name && err.name.includes('Prisma')) {
          errorType = 'database_error';
        } else if (err.statusCode >= 400 && err.statusCode < 500) {
          errorType = 'client_error';
        } else if (err.statusCode >= 500) {
          errorType = 'server_error';
        }
        
        const errorDetails = {
          type: errorType,
          message: err.message || 'Unknown error',
          name: err.name,
          stack: err.stack,
          endpoint: req.originalUrl || req.url,
          method: req.method,
          statusCode: err.statusCode || err.status || 500,
          timestamp: new Date().toISOString()
        };
        
        // Include Prisma-specific details if available
        if (err.name && err.name.includes('Prisma')) {
          if (err.meta) errorDetails.meta = err.meta;
          if (err.code) errorDetails.code = err.code;
          if (err.clientVersion) errorDetails.clientVersion = err.clientVersion;
        }
        
        process.emitAppError(APP_ID, errorDetails);
      } catch (reportError) {
        console.error('Failed to report error to parent server:', reportError);
      }
    }
    
    if (!res.headersSent) {
      res.status(err.statusCode || err.status || 500).json({ 
        success: false,
        error: 'حدث خطأ في الخادم',
        message: err.message || 'حدث خطأ أثناء معالجة طلبك'
      });
    }
  });

  return app;
};