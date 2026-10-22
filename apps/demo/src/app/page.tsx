import { ContactButton } from './ContactButton';

export default function Home() {
  return (
    <>
      <h1>Widgets for every occasion</h1>
      <p>
        This is a demo site with the Hailbox widget embedded. Use the chat button in the corner, then answer
        from the inbox at <a href="http://localhost:3000">localhost:3000</a>.
      </p>
      <ContactButton />
    </>
  );
}
