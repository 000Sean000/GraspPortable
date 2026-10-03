namespace GraspPortable.App;

public partial class App : Application
{
    public App() { InitializeComponent(); }
    protected override Window CreateWindow(IActivationState? activationState) =>
        new(new MainPage()) { Title = "GraspPortable · Windows 試用版", Width = 1360, Height = 900, MinimumWidth = 820, MinimumHeight = 600 };
}
