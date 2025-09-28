import ProfileForm from "../../../../components/ProfileForm";

export default function ProfilePage() {
  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-600">
          Update your contact details so the team knows how to reach you.
        </p>
      </header>
      <ProfileForm />
    </section>
  );
}
