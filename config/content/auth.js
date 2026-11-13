export const AUTH_CONTENT = {
  brand: 'PikolScore',

  signIn: {
    heading: 'Sign in',
    forgotPassword: 'Forgot password?',
    submit: 'Sign in',
    submitting: 'Signing in…',
    footerPrompt: "Don't have an account? ",
    footerLink: 'Sign up',
  },

  signUp: {
    heading: 'Sign up',
    submit: 'Sign up',
    submitting: 'Creating account…',
    footerPrompt: 'Already have an account? ',
    footerLink: 'Sign in',
  },

  fields: {
    fullName: {
      label: 'Official name',
      placeholder: 'Alex Morgan',
    },
    email: {
      label: 'Email',
      placeholder: 'you@email.com',
    },
    password: {
      label: 'Password',
      signInPlaceholder: '',
      signUpPlaceholder: 'At least 6 characters',
    },
    confirmPassword: {
      label: 'Confirm password',
      placeholder: 'Re-enter password',
    },
  },
};

export default AUTH_CONTENT;
