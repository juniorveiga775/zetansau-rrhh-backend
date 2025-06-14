const nodemailer = require('nodemailer');

// Configuración de nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_PORT == 465, // true para puerto 465, false para otros puertos
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false // Para entornos de desarrollo
  }
});

// Función para verificar la conexión del transporter
const verifyEmailConnection = async () => {
  try {
    await transporter.verify();
    console.log('✅ Conexión de email verificada correctamente');
    return { success: true };
  } catch (error) {
    console.error('❌ Error en la conexión de email:', error.message);
    return { success: false, error: error.message };
  }
};

// Plantillas de email
const emailTemplates = {
  birthdayGreeting: (firstName, lastName, position, department) => ({
    subject: `🎉 ¡Feliz Cumpleaños ${firstName}! - Zetansau`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
        <div style="background-color: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); text-align: center;">
          <div style="font-size: 60px; margin-bottom: 20px;">🎂</div>
          
          <h1 style="color: #2563eb; margin: 0 0 10px 0; font-size: 32px;">¡Feliz Cumpleaños!</h1>
          <div style="width: 80px; height: 4px; background: linear-gradient(90deg, #ff6b6b, #4ecdc4, #45b7d1); margin: 15px auto 30px auto; border-radius: 2px;"></div>
          
          <h2 style="color: #1f2937; margin: 0 0 20px 0; font-size: 24px;">${firstName} ${lastName}</h2>
          
          <p style="color: #374151; font-size: 18px; line-height: 1.6; margin-bottom: 25px;">
            En este día tan especial, todo el equipo de <strong>Zetansau</strong> te envía los mejores deseos.
          </p>
          
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; margin: 30px 0;">
            <p style="margin: 0; font-size: 18px; font-weight: bold;">🎊 ¡Que tengas un día lleno de alegría y momentos especiales! 🎊</p>
          </div>
          
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 10px; margin: 25px 0;">
            <p style="margin: 5px 0; color: #64748b; font-size: 14px;"><strong>Posición:</strong> ${position || 'Empleado'}</p>
            <p style="margin: 5px 0; color: #64748b; font-size: 14px;"><strong>Departamento:</strong> ${department || 'Zetansau'}</p>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 14px; margin: 0;">Con cariño,</p>
            <p style="color: #2563eb; font-size: 16px; font-weight: bold; margin: 5px 0 0 0;">El equipo de Zetansau 💙</p>
          </div>
        </div>
        
        <div style="text-align: center; margin-top: 20px;">
          <p style="color: white; font-size: 12px; opacity: 0.8;">Este es un mensaje automático del sistema de RRHH de Zetansau</p>
        </div>
      </div>
    `
  }),
  
  welcomeEmployee: (firstName, lastName, email, setupToken) => ({
    subject: '¡Bienvenido al Portal de RRHH de Zetansau!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0; font-size: 28px;">¡Bienvenido a Zetansau!</h1>
            <div style="width: 50px; height: 3px; background-color: #2563eb; margin: 10px auto;"></div>
          </div>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hola <strong>${firstName} ${lastName}</strong>,</p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Te damos la bienvenida al equipo de Zetansau. Tu cuenta en el Portal de RRHH ha sido creada exitosamente.
          </p>
          
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 25px 0;">
            <h3 style="color: #1f2937; margin: 0 0 15px 0; font-size: 18px;">📧 Tu email de acceso:</h3>
            <p style="margin: 8px 0; color: #374151;"><strong>Email:</strong> ${email}</p>
          </div>
          
          <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 25px 0;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>🔐 Configuración de contraseña:</strong> Debes crear tu propia contraseña para acceder al portal. Haz clic en el botón de abajo para configurarla.
            </p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/setup-password?token=${setupToken}" 
               style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Configurar mi Contraseña
            </a>
          </div>
          
          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
            <h4 style="color: #1f2937; margin: 0 0 15px 0;">📋 En el portal podrás:</h4>
            <ul style="color: #374151; line-height: 1.6; padding-left: 20px;">
              <li>Consultar y descargar tus documentos</li>
              <li>Acceder a tus nóminas mensuales</li>
              <li>Realizar solicitudes de vacaciones y permisos</li>
              <li>Actualizar tu información personal</li>
              <li>Revisar notificaciones importantes</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              Si tienes alguna pregunta, no dudes en contactar con el departamento de RRHH.
            </p>
            <p style="color: #6b7280; font-size: 12px; margin: 10px 0 0 0;">
              © 2025 Zetansau - Portal de Recursos Humanos
            </p>
          </div>
        </div>
      </div>
    `
  }),
  
  generalNotification: (title, message, actionUrl = null) => ({
    subject: `Notificación - ${title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0; font-size: 24px;">${title}</h1>
            <div style="width: 50px; height: 3px; background-color: #2563eb; margin: 10px auto;"></div>
          </div>
          
          <div style="color: #374151; font-size: 16px; line-height: 1.6; margin: 25px 0;">
            ${message}
          </div>
          
          ${actionUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${actionUrl}" 
                 style="background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Ver en el Portal
              </a>
            </div>
          ` : ''}
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 12px; margin: 0;">
              © 2025 Zetansau - Portal de Recursos Humanos
            </p>
          </div>
        </div>
      </div>
    `
  })
};

// Función para enviar email de bienvenida a empleado
const sendWelcomeEmail = async (firstName, lastName, email, setupToken) => {
  try {
    const template = emailTemplates.welcomeEmployee(firstName, lastName, email, setupToken);
    
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: template.subject,
      html: template.html
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Email de bienvenida enviado a: ${email}`);
    return { success: true };
  } catch (error) {
    console.error('Error enviando email de bienvenida:', error);
    return { success: false, error: error.message };
  }
};

// Función para enviar notificación general
const sendGeneralNotification = async (recipients, title, message, actionUrl = null) => {
  try {
    const template = emailTemplates.generalNotification(title, message, actionUrl);
    
    // Si recipients es un string, convertir a array
    const emailList = Array.isArray(recipients) ? recipients : [recipients];
    
    const promises = emailList.map(email => {
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: template.subject,
        html: template.html
      };
      
      return transporter.sendMail(mailOptions);
    });
    
    await Promise.all(promises);
    console.log(`Notificación general enviada a ${emailList.length} destinatarios`);
    return { success: true };
  } catch (error) {
    console.error('Error enviando notificación general:', error);
    return { success: false, error: error.message };
  }
};

// Función para obtener todos los emails de empleados activos
const getAllEmployeeEmails = async (pool) => {
  try {
    const [employees] = await pool.execute(
      'SELECT email FROM users WHERE role = "employee" AND status = "active"'
    );
    return employees.map(emp => emp.email);
  } catch (error) {
    console.error('Error obteniendo emails de empleados:', error);
    return [];
  }
};

// Función para enviar felicitación de cumpleaños
const sendBirthdayEmail = async (employee) => {
  try {
    const template = emailTemplates.birthdayGreeting(
      employee.first_name,
      employee.last_name,
      employee.position,
      employee.department
    );
    
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: employee.email,
      subject: template.subject,
      html: template.html
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Felicitación de cumpleaños enviada a: ${employee.email}`);
    return { success: true };
  } catch (error) {
    console.error('Error enviando felicitación de cumpleaños:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendWelcomeEmail,
  sendBirthdayEmail,
  sendGeneralNotification,
  getAllEmployeeEmails,
  transporter,
  verifyEmailConnection
};